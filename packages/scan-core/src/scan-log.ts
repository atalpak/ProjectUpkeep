import type { Candidate, Printing } from './types';
import {
  ART_CONFIDENCE_RATIO, ART_OVERRIDE_FOOTER_RATIO, artCoversAll, artVerdict, canonicalNumber,
  type ArtResult, type PrintingHints, type PrintingRanking,
} from './printing';

/**
 * The evidence behind ONE scan read, in a shape a person can paste into a chat.
 * Owner report 2026-09-24: quick scan opened the right card on the wrong
 * printing (LTR #667 for a card whose footer says #216) and nothing on the phone
 * showed why. The Settings "Scan diagnostics" switch records the last few reads
 * with this; everything here is pure (no storage, no React) so it is tested like
 * the rest of scan-core, and none of it runs unless the switch is on.
 *
 * Deliberately a description of what the scanner DID, never an input to it:
 * recording must not change a scan, so nothing here is read back by the scan path.
 */

export const SCAN_LOG_MAX = 30;
/** Candidate rows kept per read: enough to see the tie, few enough to keep 30 reads small. */
export const SCAN_LOG_MAX_CANDIDATES = 8;
const MAX_LINES = 12;
const MAX_LINE_CHARS = 80;

export type ScanLogSource = 'quick/outline' | 'quick/guide' | 'scan/outline' | 'scan/guide';

export interface ScanLogCandidate {
  /** "ltr #216" */
  printing: string;
  /** Free text: "set+number, rarity, weight 15" for the footer ranking; "score 1.00 evidence name" for name candidates. */
  evidence: string;
  releasedAt?: string;
}

export interface ScanLogArt {
  candidates: Array<{ printing: string; distance: number | null }>;
  bestDistance: number | null;
  runnerUpDistance: number | null;
  /** best / runner-up; the switch needs it under `requiredRatio`. */
  ratio: number | null;
  requiredRatio: number;
  winner: string | null;
  applied: boolean;
  /** Why it was or was not applied, in words. */
  reason: string;
}

export interface ScanLogEntry {
  id: string;
  /** Epoch ms. */
  at: number;
  source: ScanLogSource;
  title: string;
  /** The raw footer lines the native side read (already truncated). */
  printingLines: string[];
  hints: { setCode?: string; collectorNumber?: string; rarity?: string; language?: string };
  /** How the name resolved: the accepted card, or why the read was rejected. */
  match: string;
  candidates: ScanLogCandidate[];
  /** The best-guess printing chosen and why. `null` printing = no guess, the sheet used its default. */
  guess: { printing: string | null; why: string } | null;
  /** Whether a picture check was set up for this read (quick scan only). */
  artPlanned: boolean | null;
  art?: ScanLogArt;
  /** The printing the details sheet finally showed / the scan staged. */
  finalPrinting?: string;
  note?: string;
}

export const printingLabel = (p: Pick<Printing, 'setCode' | 'collectorNumber'>) => `${p.setCode.toLowerCase()} #${p.collectorNumber}`;

export function clipLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? []).slice(0, MAX_LINES).map(l => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS - 1)}…` : l));
}

export function hintsForLog(h: PrintingHints): ScanLogEntry['hints'] {
  const out: ScanLogEntry['hints'] = {};
  if (h.setCode) out.setCode = h.setCode;
  if (h.collectorNumber) out.collectorNumber = h.collectorNumber;
  if (h.rarity) out.rarity = h.rarity;
  if (h.language) out.language = h.language;
  return out;
}

/** `rankPrintings` as log rows: which footer parts each printing matched, and the weight that ordered them. */
export function describeRanking(ranking: PrintingRanking, limit = SCAN_LOG_MAX_CANDIDATES): ScanLogCandidate[] {
  return ranking.ranked.slice(0, limit).map(r => {
    const weight = (r.matchedSet && r.matchedNumber ? 8 : 0) + (r.matchedNumber ? 4 : 0) + (r.matchedSet ? 2 : 0) + (r.matchedRarity ? 1 : 0);
    const matched = [r.matchedSet && 'set', r.matchedNumber && 'number', r.matchedRarity && 'rarity'].filter(Boolean).join('+') || 'nothing';
    const c: ScanLogCandidate = { printing: printingLabel(r.printing), evidence: `matched ${matched}, weight ${weight}` };
    if (r.printing.releasedAt) c.releasedAt = r.printing.releasedAt;
    return c;
  });
}

/** Name-search candidates (the main Scan tab's list) as log rows. */
export function describeCandidates(candidates: readonly Candidate[], limit = SCAN_LOG_MAX_CANDIDATES): ScanLogCandidate[] {
  return candidates.slice(0, limit).map(c => {
    const row: ScanLogCandidate = { printing: `${c.printing.name} ${printingLabel(c.printing)}`, evidence: `score ${c.score.toFixed(2)}, ${c.evidence}` };
    if (c.printing.releasedAt) row.releasedAt = c.printing.releasedAt;
    return row;
  });
}

/**
 * Why `bestGuessPrinting` returned what it did, mirroring its rules in words. When there is no guess the
 * reason names the fallback that will actually pick (CardDetails' `pickRepresentative`, i.e. `regularFirst`).
 */
export function explainGuess(ranking: PrintingRanking, hints: PrintingHints): { printing: string | null; why: string } {
  const top = ranking.ranked[0]?.printing;
  const label = top ? printingLabel(top) : null;
  const read = [hints.setCode && `set ${hints.setCode}`, hints.collectorNumber && `number ${canonicalNumber(hints.collectorNumber)}`].filter(Boolean).join(', ') || 'nothing usable';
  switch (ranking.printingConfidence) {
    case 'exact': return { printing: label, why: `footer exact: set and number both matched one printing (read ${read})` };
    case 'partial': return { printing: label, why: `footer partial: only one of set/number matched, and it names one printing (read ${read})` };
    case 'unique': return { printing: label, why: 'only printing of this card in the catalog' };
    default: {
      const tied = ranking.ranked.length;
      return { printing: null, why: `no guess: footer read ${read}, which does not single out one of ${tied} printings; the sheet uses its default (plain number, nonfoil, NEWEST release, then lowest number = ${label ?? 'none'})` };
    }
  }
}

/**
 * The picture check's outcome in words: what was compared, how decisive the winner was, and whether
 * CardDetails could apply it. Mirrors `artSwitchNow`'s gates in the same order, so the reason is the
 * first gate that fails; a unit test holds the two in agreement.
 */
export function explainArt(input: {
  all: readonly Printing[]; art: ArtResult | null; footerGuess: boolean; userPicked: boolean; adding: boolean; alreadySelected?: string | null;
}): ScanLogArt {
  const { all, art, footerGuess, userPicked, adding } = input;
  const requiredRatio = footerGuess ? ART_OVERRIDE_FOOTER_RATIO : ART_CONFIDENCE_RATIO;
  const label = (id: string) => { const p = all.find(x => x.id === id); return p ? printingLabel(p) : id.slice(0, 8); };
  const base: ScanLogArt = { candidates: [], bestDistance: null, runnerUpDistance: null, ratio: null, requiredRatio, winner: null, applied: false, reason: '' };
  if (!art) return { ...base, reason: 'no picture result (download failed, timed out, sheet closed or older build)' };
  base.candidates = art.ids.map((id, i) => ({ printing: label(id), distance: Number.isFinite(art.distances[i]) ? Number(art.distances[i]!.toFixed(4)) : null }));
  const sorted = [...art.distances].filter(d => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  base.bestDistance = sorted[0] !== undefined ? Number(sorted[0].toFixed(4)) : null;
  base.runnerUpDistance = sorted[1] !== undefined ? Number(sorted[1].toFixed(4)) : null;
  if (sorted.length > 1 && sorted[1]! > 0) base.ratio = Number((sorted[0]! / sorted[1]!).toFixed(3));
  const verdict = artVerdict(art, requiredRatio);
  base.winner = verdict ? label(verdict.bestId) : null;
  if (userPicked) return { ...base, reason: 'not applied: the person had already chosen a printing' };
  if (adding) return { ...base, reason: 'not applied: the add form was open' };
  if (all.length < 2) return { ...base, reason: 'not applied: only one printing' };
  if (!artCoversAll(all as Printing[], art)) return { ...base, reason: `not applied: only ${art.ids.length} of ${all.length} printings were compared` };
  if (!verdict?.confident) return { ...base, reason: `not applied: winner not decisive (ratio ${base.ratio ?? 'n/a'}, needs under ${requiredRatio}${footerGuess ? ', strict because the footer named the printing' : ''})` };
  if (input.alreadySelected && verdict.bestId === input.alreadySelected) return { ...base, applied: false, reason: 'confident, but the winner was already the selected printing' };
  return { ...base, applied: true, reason: `applied: decisive (ratio ${base.ratio ?? 'n/a'} < ${requiredRatio})` };
}

/** Newest last, capped. Returns a new array. */
export function pushScanLog(entries: readonly ScanLogEntry[], entry: ScanLogEntry, max = SCAN_LOG_MAX): ScanLogEntry[] {
  return [...entries, entry].slice(-max);
}

/** Replaces the entry with this id (a no-op if it has scrolled out of the buffer). */
export function patchScanLog(entries: readonly ScanLogEntry[], id: string, patch: Partial<ScanLogEntry>): ScanLogEntry[] {
  return entries.map(e => (e.id === id ? { ...e, ...patch } : e));
}

/** Stored data is untrusted after an app update: keep only what still looks like an entry. */
export function readScanLog(raw: string | null | undefined): ScanLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ScanLogEntry => !!e && typeof e === 'object' && typeof (e as ScanLogEntry).id === 'string' && typeof (e as ScanLogEntry).at === 'number' && Array.isArray((e as ScanLogEntry).candidates)).slice(-SCAN_LOG_MAX);
  } catch { return []; }
}

export function summarizeScanEntry(e: ScanLogEntry): string {
  const when = new Date(e.at).toISOString().slice(11, 19);
  return `${when} ${e.source} | ${e.title || '(no title)'} | ${e.finalPrinting ?? e.guess?.printing ?? 'no printing'}`;
}

export function formatScanEntry(e: ScanLogEntry, n?: number): string {
  const out: string[] = [];
  out.push(`#${n ?? '?'} ${new Date(e.at).toISOString()} source=${e.source}`);
  out.push(`title read: ${e.title ? JSON.stringify(e.title) : '(none)'}`);
  out.push(`match: ${e.match}`);
  out.push(`footer lines: ${e.printingLines.length ? e.printingLines.map(l => JSON.stringify(l)).join(' ') : '(none)'}`);
  const h = e.hints;
  out.push(`hints: set=${h.setCode ?? '-'} number=${h.collectorNumber ?? '-'} rarity=${h.rarity ?? '-'} language=${h.language ?? '-'}`);
  if (e.candidates.length) {
    out.push('candidates:');
    for (const c of e.candidates) out.push(`  - ${c.printing} (${c.evidence}${c.releasedAt ? `, released ${c.releasedAt}` : ''})`);
  }
  if (e.guess) out.push(`best guess: ${e.guess.printing ?? 'none'} -- ${e.guess.why}`);
  if (e.artPlanned !== null) out.push(`picture check planned: ${e.artPlanned ? 'yes' : 'no'}`);
  if (e.art) {
    const a = e.art;
    out.push(`picture check: ${a.candidates.map(c => `${c.printing}=${c.distance ?? 'n/a'}`).join(', ') || '(no distances)'}`);
    out.push(`  best ${a.bestDistance ?? '-'} runner-up ${a.runnerUpDistance ?? '-'} ratio ${a.ratio ?? '-'} (needs < ${a.requiredRatio}) winner ${a.winner ?? '-'} -> ${a.reason}`);
  }
  out.push(`final printing: ${e.finalPrinting ?? '(not recorded)'}`);
  if (e.note) out.push(`note: ${e.note}`);
  return out.join('\n');
}

export function formatScanLog(entries: readonly ScanLogEntry[], header?: string): string {
  const lines = [header ?? 'Upkeep scan log', `${entries.length} read(s), newest first`, ''];
  [...entries].reverse().forEach((e, i) => { lines.push(formatScanEntry(e, i + 1), ''); });
  return lines.join('\n').trimEnd();
}
