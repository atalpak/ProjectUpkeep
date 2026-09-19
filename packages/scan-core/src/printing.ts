import type { Printing } from './types';

/**
 * Which PRINTING of a card a scan is, as opposed to which card. Everything
 * here is pure so it is tested like the rest of scan-core.
 *
 * Why this exists (see apps/mobile/docs/SCANNER_ALTERNATE_ART_PLAN.md): the
 * name identifies the card, but a rare or alternate-art card has many
 * printings that share one name, and picking among them arbitrarily is how a
 * full-art promo used to open as its plain reprint. Three independent pieces
 * of evidence can separate them, and none is trusted alone:
 *
 *   1. the footer text (collector number, set code, rarity letter),
 *   2. the card's picture against each candidate's picture (native, see
 *      packages/upkeep-vision `rankCardImage`),
 *   3. the person, who taps the right one when 1 and 2 cannot agree.
 *
 * `decidePrinting` is the policy that combines them. Its one rule: a printing
 * is only pinned on positive agreement of independent evidence; otherwise the
 * caller must ask. The picture alone never pins one of several printings.
 */

export interface PrintingHints {
  setCode?: string;
  collectorNumber?: string;
  /** Full Scryfall rarity word, from the single footer letter (C/U/R/M/S). */
  rarity?: string;
}

/** Language codes that sit next to the set code ("SOC • EN") and must not be mistaken for one. */
const LANGUAGE_TOKENS = new Set(['EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'JA', 'JP', 'KO', 'RU', 'ZH', 'ZHS', 'ZHT', 'PH', 'HE', 'LA', 'GR', 'AR', 'SA']);
const RARITY_LETTERS: Record<string, string> = { C: 'common', U: 'uncommon', R: 'rare', M: 'mythic', S: 'special' };
/** Lines that carry numbers and letters but are never the printing: copyright and artist credit. */
const NOT_A_PRINTING_LINE = /©|™|®|\(C\)|WIZARDS|COAST|ILLUS|\bLLC\b/;

export function canonicalNumber(value: string) { return value.split('/')[0]!.trim().toLowerCase().replace(/^0+(?=\d)/, ''); }

/**
 * Reads the set code, collector number and rarity letter out of the footer's
 * OCR lines.
 *
 * Modern cards print these on separate lines ("M 0236" over "SOC • EN"), older
 * ones as "123/264 R" over "M19 • EN", so the lines are read as one pool of
 * tokens rather than looking for "SET NUMBER" on one line. The number may
 * carry leading zeros ("0718") and a "/total". `knownSets` (lower-case codes
 * from the catalog) rejects OCR noise as a set code; without it a set code is
 * accepted on shape alone, and anything in the language list is never one.
 * A number with no readable set is still returned: the number alone narrows
 * a name's printings a great deal.
 */
export function printingHints(lines: string[], knownSets?: ReadonlySet<string>): PrintingHints {
  let number: { value: string; score: number } | null = null;
  let set: { value: string; score: number } | null = null;
  let rarity: string | undefined;

  for (const raw of lines) {
    const upper = raw.toUpperCase();
    if (NOT_A_PRINTING_LINE.test(upper)) continue;
    const line = upper.replace(/[•·∙●▪|,;:_.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const tokens = line.split(' ');

    // "0236/0300" is the most specific shape there is: a number over a print run.
    const total = line.match(/(?:^| )(\d{1,5}[A-Z★]?) ?\/ ?\d{1,5}(?= |$)/);
    let lineNumber: string | undefined;
    if (total) { lineNumber = total[1]; if (!number || number.score < 3) number = { value: lineNumber!, score: 3 }; }
    else {
      const plain = tokens.find(t => /^\d{1,5}[A-Z★]?$/.test(t));
      if (plain) { lineNumber = plain; if (!number) number = { value: plain, score: 1 }; }
    }

    for (const [i, token] of tokens.entries()) {
      if (token.length === 1 && RARITY_LETTERS[token]) { rarity ??= RARITY_LETTERS[token]; continue; }
      if (!/^[A-Z0-9]{2,5}$/.test(token) || !/[A-Z]/.test(token) || LANGUAGE_TOKENS.has(token)) continue;
      // A run of digits with a stray letter is a number ("718S"), not a set.
      if (/^\d+[A-Z★]?$/.test(token)) continue;
      if (knownSets && !knownSets.has(token.toLowerCase())) continue;
      // "SOC EN" and "M19 EN" are the shape of a set line; a set code beside
      // the number is next best. Anything else only counts if nothing better does.
      const score = (LANGUAGE_TOKENS.has(tokens[i + 1] ?? '') ? 3 : 0) + (lineNumber ? 2 : 0) + 1;
      if (!set || score > set.score) set = { value: token, score };
    }
  }
  const out: PrintingHints = {};
  if (set) out.setCode = set.value;
  if (number) out.collectorNumber = number.value;
  if (rarity) out.rarity = rarity;
  return out;
}

export type PrintingConfidence =
  /** Set code AND collector number both matched exactly one printing. */
  | 'exact'
  /** The card has one printing in the catalog: there is nothing to confuse it with. */
  | 'unique'
  /** Only one of set / number matched, and it names exactly one printing. */
  | 'partial'
  /** Several printings remain possible. */
  | 'none';

export interface RankedPrinting {
  printing: Printing;
  matchedSet: boolean;
  matchedNumber: boolean;
  matchedRarity: boolean;
}

export interface PrintingRanking {
  ranked: RankedPrinting[];
  printingConfidence: PrintingConfidence;
}

/** Newest first, then a fixed order by set and number. The id only decides between identical rows. */
function tieOrder(a: Printing, b: Printing): number {
  return (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.setCode.localeCompare(b.setCode) ||
    canonicalNumber(a.collectorNumber).localeCompare(canonicalNumber(b.collectorNumber), 'en', { numeric: true }) || a.id.localeCompare(b.id);
}

/**
 * Every printing of ONE card (the caller passes those of a single oracle id),
 * ordered by how well the footer evidence fits, with an explicit statement of
 * how sure that makes us. Evidence that fits none of them is ignored, never
 * used to drop a printing: OCR misreads a digit often enough that excluding
 * on it would remove the right card.
 */
export function rankPrintings(printings: Printing[], hints: PrintingHints): PrintingRanking {
  const number = hints.collectorNumber ? canonicalNumber(hints.collectorNumber) : null;
  const ranked = printings.map((printing): RankedPrinting => ({
    printing,
    matchedSet: !!hints.setCode && hints.setCode.toLowerCase() === printing.setCode.toLowerCase(),
    matchedNumber: number !== null && number === canonicalNumber(printing.collectorNumber),
    matchedRarity: !!hints.rarity && hints.rarity === printing.rarity,
  }));
  const weight = (r: RankedPrinting) => (r.matchedSet && r.matchedNumber ? 8 : 0) + (r.matchedNumber ? 4 : 0) + (r.matchedSet ? 2 : 0) + (r.matchedRarity ? 1 : 0);
  ranked.sort((a, b) => weight(b) - weight(a) || tieOrder(a.printing, b.printing));

  const both = ranked.filter(r => r.matchedSet && r.matchedNumber);
  const byNumber = ranked.filter(r => r.matchedNumber);
  const bySet = ranked.filter(r => r.matchedSet);
  let printingConfidence: PrintingConfidence = 'none';
  if (ranked.length === 1) printingConfidence = 'unique';
  else if (both.length === 1) printingConfidence = 'exact';
  else if (both.length === 0 && (byNumber.length === 1 || (byNumber.length === 0 && bySet.length === 1))) printingConfidence = 'partial';
  return { ranked, printingConfidence };
}

/** How much closer the best picture must be than the runner-up to count as a clear winner. Ported from the native compareArtwork's 0.90. */
export const ART_CONFIDENCE_RATIO = 0.9;
/** Most references worth downloading and comparing for one scan. */
export const MAX_ART_CANDIDATES = 24;

/** Candidates whose picture can be compared, best footer fit first, capped. */
export function artShortlist(ranked: RankedPrinting[], max = MAX_ART_CANDIDATES): Printing[] {
  return ranked.filter(r => !!r.printing.imageUri).slice(0, max).map(r => r.printing);
}

/** Feature-print distances (lower is closer) for the printings that could be compared. */
export interface ArtResult { ids: string[]; distances: number[] }

/**
 * The closest picture, and whether it is clearly closer than every other. Two
 * printings with the same art are equally close, so they can never be
 * "confident": only the footer can separate those.
 */
export function artVerdict(art: ArtResult): { bestId: string; confident: boolean } | null {
  if (art.ids.length === 0 || art.ids.length !== art.distances.length || art.distances.some(d => !Number.isFinite(d) || d < 0)) return null;
  let best = 0;
  art.distances.forEach((d, i) => { if (d < art.distances[best]!) best = i; });
  const second = Math.min(...art.distances.filter((_, i) => i !== best));
  const confident = art.ids.length === 1 || art.distances[best]! < second * ART_CONFIDENCE_RATIO;
  return { bestId: art.ids[best]!, confident };
}

export type ChooseReason =
  /** No usable picture comparison (old build, download failed, no images). */
  | 'no-art'
  /** The footer and the picture point at different printings. */
  | 'disagree'
  /** Neither the footer nor the picture settled it. */
  | 'unsure';

export type PrintingDecision =
  | { kind: 'pinned'; printing: Printing }
  /** `options` is best guess first; `best` is pre-highlighted but needs one tap to confirm. */
  | { kind: 'choose'; options: Printing[]; best: string | null; reason: ChooseReason };

/** How many candidates the "which printing?" picker shows; the details page lists the rest. */
export const PICKER_OPTIONS = 8;

/**
 * True only when every printing of the card was actually compared. A picture
 * "winner" among a subset (downloads that failed, printings with no image, a
 * shortlist cut at the cap) proves nothing about the ones left out, and the
 * left-out one is exactly the alternate art we must not miss.
 */
export function artCoversAll(all: Printing[], art: ArtResult | null): boolean {
  if (!art) return false;
  const seen = new Set(art.ids);
  return all.every(p => seen.has(p.id));
}

/**
 * Whether every printing is known to carry the very same picture (the same
 * image address). Nothing else in the catalog says so, so this is only ever
 * true on positive evidence; when it is not knowable, the answer is no.
 */
export function sharesArtwork(all: Printing[]): boolean {
  const first = all[0]?.imageUri;
  return !!first && all.every(p => p.imageUri === first);
}

/**
 * Combines footer evidence with the picture comparison. The owner's rule is
 * that a wrong printing must never be landed silently, and the picture ALONE
 * never pins one of several printings: it may only pre-highlight the best guess
 * in the picker. A pin among several needs two independent things to agree:
 *
 *  - one printing exists: pinned;
 *  - the footer names a printing AND the picture is clearly closest to that same
 *    one: pinned when the footer is exact, or when it is partial and every
 *    printing was compared (a lone matching number is a weak claim, so it needs
 *    the whole field checked as well);
 *  - an exact footer names one and every printing is known to share identical
 *    artwork: pinned, since then no picture could be wrong;
 *  - anything else, including a confident picture with no footer or one the
 *    footer contradicts: ask, with the best guess highlighted.
 */
export function decidePrinting(ranking: PrintingRanking, art: ArtResult | null): PrintingDecision {
  const { ranked, printingConfidence } = ranking;
  if (ranked.length === 0) throw new Error('decidePrinting needs at least one printing');
  const all = ranked.map(r => r.printing);
  if (printingConfidence === 'unique') return { kind: 'pinned', printing: ranked[0]!.printing };

  const footer = printingConfidence === 'exact' || printingConfidence === 'partial' ? ranked[0]!.printing : null;
  const exactFooter = printingConfidence === 'exact' ? footer : null;
  const verdict = art ? artVerdict(art) : null;
  const covered = artCoversAll(all, art);
  const choose = (best: string | null, reason: ChooseReason): PrintingDecision => {
    // The best guess leads, then the picture's order where there is one, else the footer's.
    const rank = art ? new Map(art.ids.map((id, i) => [id, art.distances[i]!])) : new Map<string, number>();
    const rest = all.filter(p => p.id !== best).sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    const lead = best ? all.filter(p => p.id === best) : [];
    return { kind: 'choose', options: [...lead, ...rest].slice(0, PICKER_OPTIONS), best, reason };
  };
  // Identical pictures make the footer the only separator; it must be exact.
  if (exactFooter && sharesArtwork(all)) return { kind: 'pinned', printing: exactFooter };

  if (!art || !verdict) return choose(footer?.id ?? null, 'no-art');

  if (verdict.confident) {
    const best = all.find(p => p.id === verdict.bestId);
    if (!best) return choose(footer?.id ?? null, 'no-art');
    if (footer && footer.id !== best.id) return choose(best.id, 'disagree');
    if (footer && (exactFooter || covered)) return { kind: 'pinned', printing: best };
    return choose(best.id, 'unsure');
  }
  return choose(footer?.id ?? verdict.bestId, 'unsure');
}

/**
 * Keeps only the printings whose distance is a usable number (finite, not the
 * native "could not compare" -1). `distances` lines up with `candidates`; a
 * missing or junk entry drops that candidate rather than poisoning the rest.
 */
export function usableArt(candidateIds: string[], distances: ArrayLike<unknown> | null | undefined): ArtResult | null {
  if (!distances) return null;
  const ids: string[] = [];
  const kept: number[] = [];
  candidateIds.forEach((id, i) => {
    const d = distances[i];
    if (typeof d === 'number' && Number.isFinite(d) && d >= 0) { ids.push(id); kept.push(d); }
  });
  return ids.length ? { ids, distances: kept } : null;
}

/**
 * Resolves to `fallback` if `work` takes longer than `ms` or throws. The timer
 * is always cleared and a result that arrives late is dropped.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    let done = false;
    const finish = (value: T) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish(fallback), ms);
    work.then(finish, () => finish(fallback));
  });
}

/**
 * Whether a printing pinned at scan time may still be trusted once CardDetails
 * has the live list. The scan decided against the offline catalog, which can be
 * stale: if the live table has a printing the catalog never knew about, the
 * scan's "there is only one" or "nothing else fits" was made without it, and
 * the person must choose. The pinned printing must also exist live.
 */
export function pinStillValid(pinnedId: string | null, knownIds: readonly string[], liveIds: readonly string[]): boolean {
  if (!pinnedId || !liveIds.includes(pinnedId)) return false;
  const known = new Set(knownIds);
  return liveIds.every(id => known.has(id));
}

/**
 * Whether CardDetails must show the printing picker and hold back adding. A scan
 * that asked to be verified needs it until the person confirms, unless its pin
 * survived `pinStillValid`. A sheet opened with no verification never does.
 */
export function needsPrintingConfirm(input: {
  verify: { pinned?: boolean; bestId: string | null; knownIds: readonly string[] } | null | undefined;
  confirmed: boolean;
  liveIds: readonly string[];
}): boolean {
  const { verify, confirmed, liveIds } = input;
  if (!verify || confirmed) return false;
  const pinnedFound = !!verify.pinned && pinStillValid(verify.bestId, verify.knownIds, liveIds);
  return !pinnedFound;
}
