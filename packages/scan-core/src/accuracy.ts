import { CardIndex } from './catalog';
import { ScanPipeline } from './pipeline';
import { quickMatch, scanBand, type QuickLimits, type ScanBand } from './band';
import type { Candidate, TextEvidence } from './types';

/**
 * Pure half of `scripts/accuracy.ts`, the offline scan-accuracy measurement.
 * It lives in src/ (not in the script) so it is unit-tested like the rest of
 * scan-core, and it runs the *shipped* matching — `ScanPipeline.matchEvidence`
 * then `quickMatch` / `scanBand` — rather than a second copy of it, so a number
 * from here is a statement about the code the phone runs. What it cannot see
 * is the OCR itself: a case is "what the OCR read", written down by hand or
 * captured from a device, never produced from an image here.
 *
 * Deliberately not exported from index.ts: the app has no use for it.
 */

/** One labelled read. `expectedId` null means "no card here": abstaining is right. */
export interface AccuracyCase {
  label: string;
  expectedId: string | null;
  /** Either the raw OCR lines as the scanner emits them... */
  lines?: string[];
  printingLines?: string[];
  /** ...or the readable shorthand, which becomes lines / printingLines below. */
  name?: string;
  setCode?: string;
  collectorNumber?: string;
}

export type Outcome = 'exact' | 'wrong-printing' | 'wrong-card' | 'abstained';

export interface Tally {
  exact: number;
  wrongPrinting: number;
  wrongCard: number;
  abstained: number;
  /** Accepted reads that claimed the exact printing (`exactPrinting`) but had the wrong id — the case that pins a bad printing. */
  pinnedWrong: number;
  /** Cases labelled "no card": how many the cutoff wrongly accepted. */
  falseAccepts: number;
  noCardTotal: number;
  total: number;
}

export interface SweepRow extends QuickLimits { tally: Tally }

export function parseCases(value: unknown): AccuracyCase[] {
  const cases = (value as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(cases)) throw new Error('Fixture must be an object with a "cases" array');
  return cases.map((raw, i) => {
    const c = raw as AccuracyCase;
    const where = `case ${i}${c && typeof c.label === 'string' ? ` (${c.label})` : ''}`;
    if (!c || typeof c.label !== 'string' || !c.label) throw new Error(`${where}: missing label`);
    if (c.expectedId !== null && typeof c.expectedId !== 'string') throw new Error(`${where}: expectedId must be a printing id or null`);
    for (const k of ['lines', 'printingLines'] as const) {
      if (c[k] !== undefined && (!Array.isArray(c[k]) || c[k]!.some(x => typeof x !== 'string'))) throw new Error(`${where}: ${k} must be a string array`);
    }
    for (const k of ['name', 'setCode', 'collectorNumber'] as const) {
      if (c[k] !== undefined && typeof c[k] !== 'string') throw new Error(`${where}: ${k} must be a string`);
    }
    if (!c.lines?.length && !c.name) throw new Error(`${where}: needs lines or name`);
    return c;
  });
}

export function toEvidence(c: AccuracyCase): TextEvidence {
  const lines = c.lines ?? (c.name ? [c.name] : []);
  const printingLines = c.printingLines ?? (c.setCode && c.collectorNumber ? [`${c.setCode} ${c.collectorNumber}`] : []);
  return { lines, printingLines };
}

export interface ScoredCase {
  case: AccuracyCase;
  /** Set when expectedId is a card; undefined for a "no card" case. */
  expectedOracleId?: string;
  candidates: Candidate[];
}

/**
 * Matching is done once per case; the sweep then only re-applies the cheap
 * cutoffs. Cases naming an id the catalog does not contain cannot be judged
 * and are returned in `missing` rather than silently counted wrong.
 */
export function scoreCases(index: CardIndex, cases: AccuracyCase[]): { scored: ScoredCase[]; missing: string[] } {
  const pipeline = new ScanPipeline(index, { readText: async () => { throw new Error('accuracy: no OCR port'); } });
  const scored: ScoredCase[] = [];
  const missing: string[] = [];
  for (const c of cases) {
    let expectedOracleId: string | undefined;
    if (c.expectedId !== null) {
      const expected = index.get(c.expectedId);
      if (!expected) { missing.push(c.label); continue; }
      expectedOracleId = expected.oracleId;
    }
    scored.push({ case: c, expectedOracleId, candidates: pipeline.matchEvidence(toEvidence(c)).candidates });
  }
  return { scored, missing };
}

export function classify(s: ScoredCase, limits: QuickLimits): { outcome: Outcome; pinnedWrong: boolean } {
  const match = quickMatch(s.candidates, limits);
  if (!match.ok) return { outcome: 'abstained', pinnedWrong: false };
  if (match.printing.id === s.case.expectedId) return { outcome: 'exact', pinnedWrong: false };
  const sameCard = match.printing.oracleId === s.expectedOracleId;
  return { outcome: sameCard ? 'wrong-printing' : 'wrong-card', pinnedWrong: match.exactPrinting };
}

export function tally(scored: ScoredCase[], limits: QuickLimits): Tally {
  const t: Tally = { exact: 0, wrongPrinting: 0, wrongCard: 0, abstained: 0, pinnedWrong: 0, falseAccepts: 0, noCardTotal: 0, total: 0 };
  for (const s of scored) {
    const { outcome, pinnedWrong } = classify(s, limits);
    if (s.case.expectedId === null) {
      // Kept out of the four-way split: there is no right answer to be
      // "wrong" about, only whether the cutoff let junk through.
      t.noCardTotal++;
      if (outcome !== 'abstained') t.falseAccepts++;
      continue;
    }
    t.total++;
    if (pinnedWrong) t.pinnedWrong++;
    if (outcome === 'exact') t.exact++;
    else if (outcome === 'wrong-printing') t.wrongPrinting++;
    else if (outcome === 'wrong-card') t.wrongCard++;
    else t.abstained++;
  }
  return t;
}

export const DEFAULT_MIN_SCORES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
export const DEFAULT_MARGINS = [0, 0.02, 0.05, 0.1, 0.2];

export function sweep(scored: ScoredCase[], minScores = DEFAULT_MIN_SCORES, margins = DEFAULT_MARGINS): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const minScore of minScores) for (const ambiguityMargin of margins) {
    rows.push({ minScore, ambiguityMargin, tally: tally(scored, { minScore, ambiguityMargin }) });
  }
  return rows;
}

/** The scanner screen's own view: no abstaining, just how often the top candidate is right and how the band labels it. */
export function bandSummary(scored: ScoredCase[]): Record<ScanBand, { total: number; topExact: number; topSameCard: number }> {
  const out: Record<ScanBand, { total: number; topExact: number; topSameCard: number }> = {
    confident: { total: 0, topExact: 0, topSameCard: 0 }, uncertain: { total: 0, topExact: 0, topSameCard: 0 }, none: { total: 0, topExact: 0, topSameCard: 0 },
  };
  for (const s of scored) {
    if (s.case.expectedId === null) continue;
    const band = scanBand(s.candidates);
    const row = out[band];
    row.total++;
    const top = s.candidates[0]?.printing;
    if (top?.id === s.case.expectedId) row.topExact++;
    if (top && top.oracleId === s.expectedOracleId) row.topSameCard++;
  }
  return out;
}
