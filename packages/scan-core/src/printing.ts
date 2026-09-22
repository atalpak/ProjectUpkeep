import type { LanguageCode } from '@upkeep/domain';
import type { Printing } from './types';

/**
 * Which PRINTING of a card a scan is, as opposed to which card. Everything
 * here is pure so it is tested like the rest of scan-core.
 *
 * Why this exists (see apps/mobile/docs/SCANNER_ALTERNATE_ART_PLAN.md): the
 * name identifies the card, but a rare or alternate-art card has many
 * printings that share one name, and picking among them arbitrarily is how a
 * full-art promo used to open as its plain reprint. Two independent pieces
 * of evidence can separate them, and the person can always overrule both:
 *
 *   1. the footer text (collector number, set code, rarity letter) -- instant,
 *      it decides which printing quick scan opens on;
 *   2. the card's picture against each candidate's picture (native, see
 *      packages/upkeep-vision `rankCardImage`) -- slow, so it runs in the
 *      background AFTER the details page is open and may only switch the
 *      selection when it is confident and has compared every printing.
 *
 * Owner decision 2026-09-19: quick scan no longer asks "which printing?" or
 * waits for the picture. Speed and a page that opens at once won over never
 * guessing; the printing selector on the details page is the correction path.
 */

export interface PrintingHints {
  setCode?: string;
  collectorNumber?: string;
  /** Full Scryfall rarity word, from the single footer letter (C/U/R/M/S). */
  rarity?: string;
  /**
   * The language token printed beside the set code ("SOC • JA"), mapped to
   * our vocabulary. Backlog item 8 step 4: a footer that names the printed
   * language is real evidence of what language the physical copy actually
   * is in, independent of whatever the scanner's own language setting says.
   */
  language?: LanguageCode;
}

/** Language codes that sit next to the set code ("SOC • EN") and must not be mistaken for one. */
const LANGUAGE_TOKENS = new Set(['EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'JA', 'JP', 'KO', 'RU', 'ZH', 'ZHS', 'ZHT', 'PH', 'HE', 'LA', 'GR', 'AR', 'SA']);
/**
 * Footer token -> our language vocabulary. "JP" is Scryfall/footer shorthand
 * for Japanese alongside "JA"; both map to `ja`. A bare "ZH" is genuinely
 * ambiguous between Simplified and Traditional Chinese -- Scryfall's own
 * split codes (zhs/zht) are what a footer normally prints, so bare "ZH" is
 * rare, but when it appears alone we guess `zhs` (the more common case
 * across printed sets) rather than leave it unresolved; the person can
 * correct it on the confirm sheet either way.
 */
const FOOTER_LANGUAGE_MAP: Record<string, LanguageCode> = {
  EN: 'en', DE: 'de', FR: 'fr', ES: 'es', IT: 'it', PT: 'pt', JA: 'ja', JP: 'ja', KO: 'ko', RU: 'ru',
  ZH: 'zhs', ZHS: 'zhs', ZHT: 'zht', PH: 'ph', HE: 'he', LA: 'la', GR: 'grc', AR: 'ar', SA: 'sa',
};
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
  let language: LanguageCode | undefined;

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
      // Captured before the exclusion below still runs -- the token must still
      // be rejected as a set candidate exactly as it was before this existed.
      if (LANGUAGE_TOKENS.has(token)) language ??= FOOTER_LANGUAGE_MAP[token];
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
  if (language) out.language = language;
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

/**
 * The printing to prefer when nothing else separates two of a card. Reads as
 * "the regular print": a plain collector number (no promo suffix like "91p" or
 * a star), one that can be had nonfoil, the newest release, then the LOWEST
 * number, then set code and id so the order is total and input-order free.
 *
 * Why this is not just "newest": a card's printings inside ONE set share a
 * release date, and the tie used to fall through to an arbitrary order. That is
 * how a footer read that failed opened Bloodline Bidding on ECL #385 (a
 * foil-only showcase treatment) instead of ECL #91, the ordinary card. Within a
 * set the low numbers are the regular frame and the high ones are showcase,
 * extended-art and borderless treatments, so number ascending is the right
 * proxy. Across sets a number means nothing, so the release date decides first.
 * Structural on purpose: scan-core's `Printing` and the mobile app's
 * `CardPrinting` both satisfy it, so one rule serves both.
 */
export interface RegularOrderable {
  id: string;
  setCode: string;
  collectorNumber: string;
  finishes: readonly string[];
  releasedAt?: string | null;
}

export function regularFirst(a: RegularOrderable, b: RegularOrderable): number {
  const plain = (p: RegularOrderable) => /^\d+$/.test(canonicalNumber(p.collectorNumber));
  const nonfoil = (p: RegularOrderable) => p.finishes.includes('nonfoil');
  const number = (p: RegularOrderable) => parseInt(canonicalNumber(p.collectorNumber), 10);
  return Number(plain(b)) - Number(plain(a)) || Number(nonfoil(b)) - Number(nonfoil(a)) ||
    (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') ||
    (plain(a) && plain(b) ? number(a) - number(b) : 0) ||
    a.setCode.localeCompare(b.setCode) ||
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
  ranked.sort((a, b) => weight(b) - weight(a) || regularFirst(a.printing, b.printing));

  const both = ranked.filter(r => r.matchedSet && r.matchedNumber);
  const byNumber = ranked.filter(r => r.matchedNumber);
  const bySet = ranked.filter(r => r.matchedSet);
  let printingConfidence: PrintingConfidence = 'none';
  if (ranked.length === 1) printingConfidence = 'unique';
  else if (both.length === 1) printingConfidence = 'exact';
  else if (both.length === 0 && (byNumber.length === 1 || (byNumber.length === 0 && bySet.length === 1))) printingConfidence = 'partial';
  return { ranked, printingConfidence };
}

/**
 * How much closer the best picture must be than the runner-up (best < runner-up
 * x ratio) to count as a decisive winner. It was 0.90, ported from the native
 * compareArtwork, and 0.90 is a 10% margin between two whole-card feature
 * prints, which glare, a sleeve or a thumb can produce by themselves: it is what
 * moved a Bloodline Bidding scan (ECL #91) onto a different-looking printing
 * (ECL #385). 0.75 asks for a quarter of the runner-up's distance to be
 * closed. Still an estimate, not measured on real cards.
 */
export const ART_CONFIDENCE_RATIO = 0.75;
/**
 * The stricter ratio when the selection came from the footer text, not from the
 * arbitrary default. A footer that named a printing (even only its number) is
 * real evidence, so the picture may overrule it only when it is overwhelming:
 * best under HALF the runner-up's distance.
 */
export const ART_OVERRIDE_FOOTER_RATIO = 0.5;
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
export function artVerdict(art: ArtResult, ratio = ART_CONFIDENCE_RATIO): { bestId: string; confident: boolean } | null {
  if (art.ids.length === 0 || art.ids.length !== art.distances.length || art.distances.some(d => !Number.isFinite(d) || d < 0)) return null;
  let best = 0;
  art.distances.forEach((d, i) => { if (d < art.distances[best]!) best = i; });
  const second = Math.min(...art.distances.filter((_, i) => i !== best));
  const confident = art.ids.length === 1 || art.distances[best]! < second * ratio;
  return { bestId: art.ids[best]!, confident };
}

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
 * The printing quick scan opens on, decided from the footer alone and at once.
 * An exact or partial footer match, or the card's only printing, names one;
 * otherwise null, and the caller uses its normal default (the newest ordinary
 * printing). Nothing waits on this: it is a best guess the person can change,
 * and the background picture check may refine it.
 */
export function bestGuessPrinting(ranking: PrintingRanking): Printing | null {
  const { ranked, printingConfidence } = ranking;
  if (printingConfidence === 'exact' || printingConfidence === 'partial' || printingConfidence === 'unique') return ranked[0]?.printing ?? null;
  return null;
}

/**
 * The printings worth downloading pictures for in the background, or null when
 * the comparison cannot pay off. It is skipped when the footer already named
 * the printing (exact) or there is only one, and when the picture could never
 * cover every printing (more than the cap, or one with no picture on file):
 * `artSwitchTarget` would refuse the result anyway, so the downloads would be
 * wasted work on the person's data plan.
 */
export function artCandidates(ranking: PrintingRanking, max = MAX_ART_CANDIDATES): Printing[] | null {
  const { ranked, printingConfidence } = ranking;
  if (printingConfidence === 'unique' || printingConfidence === 'exact') return null;
  if (ranked.length < 2 || ranked.length > max || ranked.some(r => !r.printing.imageUri)) return null;
  return artShortlist(ranked, max);
}

/**
 * The printing the picture may quietly switch the selection to, or null to leave
 * it alone. Only a confident winner counts, and only when EVERY printing of the
 * card was compared: a winner among a subset says nothing about the printing
 * that was left out. Identical pictures are never confident (see `artVerdict`),
 * so a card whose printings share one image is never switched.
 */
export function artSwitchTarget(all: Printing[], art: ArtResult | null, ratio = ART_CONFIDENCE_RATIO): Printing | null {
  if (!art || all.length < 2 || !artCoversAll(all, art)) return null;
  const verdict = artVerdict(art, ratio);
  if (!verdict?.confident) return null;
  return all.find(p => p.id === verdict.bestId) ?? null;
}

/**
 * Whether the background picture match may move the selection right now, and to
 * what. The picture result arrives seconds after the sheet opened, so by then
 * the sheet may have closed, been reopened on another card, or the person may
 * have chosen a printing or opened the add form. Each of those means "leave it".
 * `artName` and the printings' own names must both equal `name`: a result or
 * list that belongs to the previously opened card must never move this one.
 */
export function artSwitchNow(input: {
  /** The card the sheet is open on; null when closed. */
  name: string | null;
  /** The card name the picture result was computed for. */
  artName: string | null;
  all: Printing[];
  art: ArtResult | null;
  userPicked: boolean;
  adding: boolean;
  /** True when the open selection came from a footer match rather than the
   *  default: the picture then needs the stricter `ART_OVERRIDE_FOOTER_RATIO`. */
  footerGuess?: boolean;
}): Printing | null {
  const { name, artName, all, art, userPicked, adding, footerGuess } = input;
  if (!name || userPicked || adding || artName !== name) return null;
  if (all.length === 0 || all.some(p => p.name !== name)) return null;
  return artSwitchTarget(all, art, footerGuess ? ART_OVERRIDE_FOOTER_RATIO : ART_CONFIDENCE_RATIO);
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
 * The small (146x204) version of a Scryfall card image, for a thumbnail.
 *
 * The catalog carries only the normal-size URL per printing (adding a second
 * one would grow a bundle that has to stay under the 80 MB download cap), but
 * Scryfall serves every size from the same path with only the size segment
 * changed, so the thumbnail address is derived rather than stored. A list of
 * fifty printings then downloads ~5 KB pictures instead of ~100 KB ones. An
 * address that is not in that shape (a demo bundle, a different host) is
 * returned untouched, so this can never turn a working picture into a broken one.
 */
export function thumbnailUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  return uri.replace(/^(https:\/\/cards\.scryfall\.io\/)(?:normal|large|png|border_crop|art_crop)\//, '$1small/');
}

/** Which finishes a printing exists in, short enough for a thumbnail caption: "Foil only", "Nonfoil / Foil". */
export function finishSummary(finishes: readonly string[]): string {
  const names = finishes.map(f => (f === 'nonfoil' ? 'Nonfoil' : f === 'etched' ? 'Etched' : f === 'glossy' ? 'Glossy' : f === 'foil' ? 'Foil' : f));
  if (names.length === 0) return '';
  return names.length === 1 ? `${names[0]} only` : names.join(' / ');
}
