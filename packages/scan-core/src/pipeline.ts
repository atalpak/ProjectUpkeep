import { CardIndex } from './catalog';
import { printingHints } from './printing';
import type { Candidate, ScanEvent, ScanResult, TextEvidence } from './types';
export interface RecognitionPorts {
  readText(uri: string): Promise<TextEvidence>;
  /** Optional image-only search service/model. Never enabled implicitly or upload by default. */
  identifyImage?(uri: string, signal: AbortSignal): Promise<Candidate[]>;
  /** Re-ranks known printings; cannot identify a card when OCR has no candidates. */
  comparePrintings?(uri: string, candidates: Candidate[], signal: AbortSignal): Promise<string | null>;
  onEvent?(event: ScanEvent): void;
}
export class ScanPipeline {
  private busy = false;
  constructor(private index: CardIndex, private ports: RecognitionPorts) {}
  /**
   * The name/printing match on its own, given text somebody else already
   * read. The live iOS scanner (packages/upkeep-vision's UpkeepScannerView)
   * OCRs natively and pushes finished evidence up as an event, so it never
   * has a URI to hand `scan` — but it must rank candidates by exactly the
   * same rules, not a second copy of them. Pure and synchronous: no ports, no
   * image pass, nothing to cancel.
   */
  matchEvidence(text: TextEvidence): ScanResult {
    const hints = printingHints(text.printingLines ?? [], this.index.setCodes);
    const merged = new Map<string, Candidate>();
    for (const line of text.lines.slice(0, 8)) for (const c of this.index.search(line, hints)) {
      if (!merged.has(c.printing.id) || merged.get(c.printing.id)!.score < c.score) merged.set(c.printing.id, c);
    }
    const rank = () => [...merged.values()].sort((a,b) => Number(b.evidence === 'printing')-Number(a.evidence === 'printing') || b.score-a.score).slice(0, 50);
    let candidates = rank();

    // Footer-first fallback (backlog item 8 step 3): name matching above found
    // nothing, or nothing worth trusting. "Worth trusting" reuses the exact
    // 0.78 bar `scan()` already uses below to decide whether a second
    // recognition pass is worth running -- not a new threshold. This is
    // purely additive: it only ever ADDS candidates name search missed, and
    // only runs when name search already failed to clear that bar, so a scan
    // that already matches confidently by name is completely unaffected by
    // it. It also helps a full-art ENGLISH card whose name is off-frame (the
    // item's own stated goal), so it fires regardless of `hints.language`.
    const weakMatch = !candidates.length || candidates[0]!.score < 0.78;
    if (weakMatch && hints.setCode && hints.collectorNumber && this.index.setCodes.has(hints.setCode.toLowerCase())) {
      // Every printing at that exact set+number -- more than one when the
      // footer's language differs across copies of the same printing; all of
      // them are surfaced as candidates rather than guessing one, the same
      // way the printing picker already lets a person choose among several.
      for (const printing of this.index.byFooter(hints.setCode, hints.collectorNumber)) {
        const existing = merged.get(printing.id);
        // Mirrors rank()'s own exactPrinting score of 1 (an exact name match):
        // the footer naming an exact printing is equally strong evidence.
        if (!existing || existing.score < 1) merged.set(printing.id, { printing, score: 1, evidence: 'printing' });
      }
      candidates = rank();
    }

    const result: ScanResult = { candidates, method: candidates.length ? 'ocr' : 'none', needsReview: true, warnings: [] };
    // Omitted rather than set to `undefined` when there is no hint: an
    // explicit `languageHint: undefined` key is a different shape from no
    // key at all to a strict-equal comparison, and callers should be able to
    // treat "no hint" as "key absent" without a special case.
    if (hints.language) result.languageHint = hints.language;
    return result;
  }

  async scan(uri: string, signal: AbortSignal): Promise<ScanResult> {
    if (this.busy) throw new Error('A scan is already running');
    if (signal.aborted) throw new Error('Scan cancelled');
    this.busy = true;
    const started = Date.now();
    const warnings: string[] = [];
    let result: ScanResult | undefined;
    try {
      // Keep the lock until the native task settles: a JS timeout cannot cancel native OCR.
      const text = await this.ports.readText(uri);
      if (signal.aborted) throw new Error('Scan cancelled');
      const matched = this.matchEvidence(text);
      let candidates = matched.candidates;
      let method = matched.method;
      if ((!candidates.length || candidates[0]!.score < 0.78) && this.ports.identifyImage) {
        try {
          const matches = await this.ports.identifyImage(uri, signal);
          // Models may only return IDs present in our catalog; replace untrusted metadata.
          const known = matches.filter(c => this.index.get(c.printing.id) && Number.isFinite(c.score) && c.score >= 0 && c.score <= 1)
            .map(c => ({ printing: this.index.get(c.printing.id)!, score: c.score, evidence: 'image' as const }));
          if (known.length) { candidates = known.slice(0, 50); method = 'image'; }
        } catch { warnings.push('Image identification was unavailable.'); }
      } else if (candidates.length > 1 && this.ports.comparePrintings) {
        try {
          // Restrict artwork comparison to the strongest name/oracle identity.
          const shortlist = candidates.filter(c => c.printing.oracleId === candidates[0]!.printing.oracleId).slice(0, 16);
          const id = await this.ports.comparePrintings(uri, shortlist, signal);
          const match = shortlist.find(c => c.printing.id === id);
          if (match) { candidates = [{...match, evidence: 'image'}, ...candidates.filter(c => c.printing.id !== id)]; method = 'image'; }
        } catch { warnings.push('Artwork comparison was unavailable.'); }
      }
      if (signal.aborted) throw new Error('Scan cancelled');
      result = { candidates, method, needsReview: true, warnings };
      return result;
    } finally {
      this.busy = false;
      // Telemetry cannot break capture; no OCR, photo, account or card identifiers.
      try { this.ports.onEvent?.({method: result?.method ?? 'none', durationMs: Date.now()-started,
        candidateCount: result?.candidates.length ?? 0, outcome: result ? (result.candidates.length ? 'review' : 'no_match') : 'error'}); } catch { /* optional */ }
    }
  }
}
