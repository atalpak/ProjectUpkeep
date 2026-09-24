import type { Candidate, Printing } from './types';
import {
  ART_CONFIDENCE_RATIO, ART_OVERRIDE_FOOTER_RATIO, artSwitchDecision, artVerdict, canonicalNumber,
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
  /** Quick scan: the printing the details sheet is on (kept current as the picture check or the person moves it). */
  finalPrinting?: string;
  /** Main Scan tab: the printing suggested at read time. Not updated if the person picks another in the sheet. */
  suggestedPrinting?: string;
  /** More than 1 when consecutive rejected quick reads were folded into this one entry. */
  rejectedCount?: number;
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
 * CardDetails could apply it. The verdict and reason come from `artSwitchDecision`, the same function
 * the sheet uses to decide, so this cannot disagree with what actually happened.
 */
export function explainArt(input: {
  all: readonly Printing[]; art: ArtResult | null; footerGuess: boolean; userPicked: boolean; adding: boolean;
  /** The card the sheet is open on and the card the picture was computed for; default to the list's own name. */
  name?: string | null; artName?: string | null; selectedId?: string | null;
}): ScanLogArt {
  const { all, art, footerGuess } = input;
  const requiredRatio = footerGuess ? ART_OVERRIDE_FOOTER_RATIO : ART_CONFIDENCE_RATIO;
  const label = (id: string) => { const p = all.find(x => x.id === id); return p ? printingLabel(p) : id.slice(0, 8); };
  const name = input.name === undefined ? (all[0]?.name ?? null) : input.name;
  const decision = artSwitchDecision({
    name, artName: input.artName === undefined ? name : input.artName, all: all as Printing[], art, userPicked: input.userPicked, adding: input.adding, footerGuess, selectedId: input.selectedId,
  });
  const out: ScanLogArt = { candidates: [], bestDistance: null, runnerUpDistance: null, ratio: null, requiredRatio, winner: null, applied: decision.target !== null, reason: decision.reason };
  if (!art) return out;
  out.candidates = art.ids.map((id, i) => ({ printing: label(id), distance: Number.isFinite(art.distances[i]) ? Number(art.distances[i]!.toFixed(4)) : null }));
  const sorted = [...art.distances].filter(d => Number.isFinite(d) && d >= 0).sort((x, y) => x - y);
  out.bestDistance = sorted[0] !== undefined ? Number(sorted[0].toFixed(4)) : null;
  out.runnerUpDistance = sorted[1] !== undefined ? Number(sorted[1].toFixed(4)) : null;
  if (sorted.length > 1 && sorted[1]! > 0) out.ratio = Number((sorted[0]! / sorted[1]!).toFixed(3));
  const verdict = artVerdict(art, requiredRatio);
  out.winner = verdict ? label(verdict.bestId) : null;
  return out;
}

/**
 * Newest last, capped. Returns a new array. A rejected quick read (`rejectedCount` set) directly after another
 * one is folded into it, keeping the latest reason and the count: quick scan retries a held card several
 * times a second, and each retry would otherwise push a real read out of the 30-entry buffer.
 */
export function pushScanLog(entries: readonly ScanLogEntry[], entry: ScanLogEntry, max = SCAN_LOG_MAX): ScanLogEntry[] {
  const last = entries[entries.length - 1];
  if (last && last.rejectedCount && entry.rejectedCount) {
    return [...entries.slice(0, -1), { ...entry, id: last.id, rejectedCount: last.rejectedCount + entry.rejectedCount }];
  }
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
  return `${when} ${e.source} | ${e.title || '(no title)'} | ${e.rejectedCount ? `rejected${e.rejectedCount > 1 ? ` x${e.rejectedCount}` : ''}` : (e.finalPrinting ?? e.suggestedPrinting ?? e.guess?.printing ?? 'no printing')}`;
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
  if (e.rejectedCount && e.rejectedCount > 1) out.push(`rejected reads folded into this entry: ${e.rejectedCount} (latest shown)`);
  if (e.suggestedPrinting) out.push(`suggested printing (top candidate at read time; not updated if changed in the sheet): ${e.suggestedPrinting}`);
  else out.push(`final printing: ${e.finalPrinting ?? '(not recorded)'}`);
  if (e.note) out.push(`note: ${e.note}`);
  return out.join('\n');
}

export function formatScanLog(entries: readonly ScanLogEntry[], header?: string): string {
  const lines = [header ?? 'Upkeep scan log', `${entries.length} read(s), newest first`, ''];
  [...entries].reverse().forEach((e, i) => { lines.push(formatScanEntry(e, i + 1), ''); });
  return lines.join('\n').trimEnd();
}
