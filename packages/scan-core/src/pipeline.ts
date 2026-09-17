import { CardIndex, printingHints } from './catalog';
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
      const hints = printingHints(text.printingLines ?? []);
      const merged = new Map<string, Candidate>();
      for (const line of text.lines.slice(0, 8)) for (const c of this.index.search(line, hints)) {
        if (!merged.has(c.printing.id) || merged.get(c.printing.id)!.score < c.score) merged.set(c.printing.id, c);
      }
      let candidates = [...merged.values()].sort((a,b) => Number(b.evidence === 'printing')-Number(a.evidence === 'printing') || b.score-a.score).slice(0, 50);
      let method: ScanResult['method'] = candidates.length ? 'ocr' : 'none';
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
