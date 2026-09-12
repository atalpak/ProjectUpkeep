/**
 * Mana costs and mana sources, reduced to what the playtest simulator needs
 * to answer one question: with these lands untapped, can this cost be paid?
 *
 * Tokenising a cost string is already solved — `manaSymbols()` in
 * `src/lib/collection/deck-view.ts` strips braces and already prefers the
 * front face of a split/adventure/flip cost — so this module reuses it rather
 * than writing a second regex that would drift from the first one.
 *
 * `producedColors()` prefers the synced `produced_mana` column (migration 32)
 * and falls back to reading basic land types off `type_line` for any card a
 * sync has not touched yet. That fallback is deliberately narrow: it only
 * recognises the five basic types, so a dual named "Steam Vents" with no
 * `produced_mana` yet produces nothing rather than a guess. A card the
 * simulator gets wrong this way undercounts sources, which fails a hand safe
 * — the opposite of a false "yes, you can cast this."
 */

import { manaSymbols } from "@/lib/collection/deck-view";

export type Color = "W" | "U" | "B" | "R" | "G";

export const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

function isColor(value: string): value is Color {
  return (COLORS as readonly string[]).includes(value);
}

/**
 * One symbol from a mana cost, in the smallest shape `canPay` needs to reason
 * about it.
 *
 *   - `color`: a plain colour pip ({W}, colours.length === 1) or a hybrid pip
 *     that can be paid by either of two colours ({W/U}, colours.length === 2).
 *   - `twobrid`: {2/W} — payable by the named colour, or by 2 generic mana
 *     when that colour is not available.
 *   - `phyrexian`: {W/P} — payable by the named colour(s), or by 2 life
 *     instead of any mana at all. Because "no mana" is always an option,
 *     `canPay` treats a phyrexian pip as already paid — see the note there.
 *   - `colorless`: {C} — colourless mana specifically, not "any colour" and
 *     not generic. This app has no notion of a colourless-producing source
 *     (`Color` above is only W/U/B/R/G — see the module header), so `canPay`
 *     folds a {C} pip into the generic total rather than failing every deck
 *     that plays an Eldrazi. Documented there, not hidden.
 */
export type Pip =
  | { kind: "color"; colors: Color[] }
  | { kind: "twobrid"; color: Color }
  | { kind: "phyrexian"; colors: Color[] }
  | { kind: "colorless" };

export type ParsedCost = { generic: number; pips: Pip[] };

/**
 * Splits a symbol like "2/W" or "W/P" into its parts and tells them apart.
 * Real costs only ever pair a colour with a number (twobrid) or with "P"
 * (phyrexian), so two parts is all this needs to handle.
 */
function splitSlash(symbol: string): string[] {
  return symbol.split("/");
}

/**
 * Parses a Scryfall mana cost string into a generic amount and a list of
 * pips. `{X}` contributes nothing — the simulator has no game state for X to
 * bind to, so treating it as 0 is the same convention the rest of the app
 * uses for an unset cost.
 *
 * An unrecognised symbol (a future Scryfall addition, or unset-only chaos
 * like "{Q}") is skipped rather than thrown on: a playtest lab that cannot
 * parse one card's cost should still simulate the other ninety-nine.
 */
export function parseCost(manaCost: string | null | undefined): ParsedCost {
  const cost: ParsedCost = { generic: 0, pips: [] };
  if (!manaCost) return cost;

  for (const symbol of manaSymbols(manaCost)) {
    if (symbol === "X" || symbol === "Y" || symbol === "Z") continue;

    if (/^\d+$/.test(symbol)) {
      cost.generic += Number(symbol);
      continue;
    }

    if (isColor(symbol)) {
      cost.pips.push({ kind: "color", colors: [symbol] });
      continue;
    }

    if (symbol === "C") {
      cost.pips.push({ kind: "colorless" });
      continue;
    }

    if (symbol.includes("/")) {
      const parts = splitSlash(symbol);
      const colors = parts.filter(isColor);

      if (parts.includes("P")) {
        cost.pips.push({ kind: "phyrexian", colors });
        continue;
      }

      const numeric = parts.find((p) => /^\d+$/.test(p));
      if (numeric && colors.length === 1) {
        cost.pips.push({ kind: "twobrid", color: colors[0] });
        continue;
      }

      if (colors.length === 2) {
        cost.pips.push({ kind: "color", colors });
        continue;
      }
    }

    // Unrecognised symbol (e.g. a future Scryfall addition) — ignored.
  }

  return cost;
}

/**
 * Which colours a card can tap for.
 *
 * `produced_mana` (migration 32) is authoritative when present. Nonland cards
 * legitimately produce mana too (mana dorks, rocks) and this column covers
 * those the same way — it is not land-specific in Scryfall's data, so this
 * function is not land-specific either.
 */
export function producedColors(card: {
  produced_mana?: string[] | null;
  type_line?: string | null;
}): Color[] {
  if (card.produced_mana) {
    return card.produced_mana.filter(isColor);
  }

  const typeLine = card.type_line ?? "";
  const found = new Set<Color>();
  if (typeLine.includes("Plains")) found.add("W");
  if (typeLine.includes("Island")) found.add("U");
  if (typeLine.includes("Swamp")) found.add("B");
  if (typeLine.includes("Mountain")) found.add("R");
  if (typeLine.includes("Forest")) found.add("G");
  return [...found];
}

/**
 * True when the front face's type line names a land.
 *
 * Split/MDFC type lines read like "Instant // Land" or "Land // Creature —
 * Elf"; only the part before " // " is what the card is while it is in your
 * hand, which is the face `isLand` is asked about everywhere in this module.
 */
export function isLand(typeLine: string | null | undefined): boolean {
  if (!typeLine) return false;
  return typeLine.split("//")[0].includes("Land");
}

/**
 * A twobrid pip has exactly two ways to pay it: its named colour, or 2
 * generic. Which one is *right* depends on what else is competing for that
 * colour source — there is no local rule for it, which is why this used to
 * be a greedy assignment and was wrong. Capped so a pathological cost (no
 * real card comes close) can't force an exponential enumeration: beyond the
 * cap, the excess twobrid pips are always priced as generic and never tried
 * for their colour. That can only make `canPay` too conservative, never too
 * generous — consistent with the rest of this module preferring to undercount
 * sources over inventing a "yes" — and no real cost has ever needed it.
 */
const MAX_ENUMERATED_TWOBRIDS = 8;

// Scratch buffers for the bipartite matching below, grown on demand and
// reused across calls. `canPay` runs in `simulate()`'s inner loop — hands ×
// turns × cards seen — so a fresh array per call here is the difference
// between a simulation that runs in a second and one that stutters the tab.
const demandingScratch: Color[][] = [];
let matchOfSource: number[] = [];
let visitedSource: boolean[] = [];

function ensureDemandingScratch(size: number): void {
  while (demandingScratch.length < size) demandingScratch.push([]);
}

function ensureSourceScratch(size: number): void {
  if (matchOfSource.length < size) {
    matchOfSource = new Array(size).fill(-1);
    visitedSource = new Array(size).fill(false);
  }
}

/**
 * Kuhn's algorithm: is there an augmenting path from demanding pip
 * `pipIndex` to some source not already claimed along the path? Reassigns
 * `matchOfSource` in place when one is found.
 */
function tryAugment(pipIndex: number, demanding: Color[][], sources: Color[][], sourceCount: number): boolean {
  const acceptable = demanding[pipIndex];
  for (let s = 0; s < sourceCount; s++) {
    if (visitedSource[s]) continue;
    if (!sources[s].some((c) => acceptable.includes(c))) continue;
    visitedSource[s] = true;
    if (matchOfSource[s] === -1 || tryAugment(matchOfSource[s], demanding, sources, sourceCount)) {
      matchOfSource[s] = pipIndex;
      return true;
    }
  }
  return false;
}

/**
 * Maximum bipartite matching between the first `pipCount` entries of
 * `demanding` and `sources` — how many of those pips can be assigned a
 * distinct source that produces one of their acceptable colours? Returns the
 * match size; the caller compares it against `pipCount` to know whether every
 * pip found a source.
 */
function maxMatch(demanding: Color[][], pipCount: number, sources: Color[][]): number {
  const sourceCount = sources.length;
  ensureSourceScratch(sourceCount);
  for (let s = 0; s < sourceCount; s++) matchOfSource[s] = -1;

  let matched = 0;
  for (let p = 0; p < pipCount; p++) {
    for (let s = 0; s < sourceCount; s++) visitedSource[s] = false;
    if (tryAugment(p, demanding, sources, sourceCount)) matched++;
  }
  return matched;
}

/**
 * Can `cost` be paid from `sources` — the colour sets of the untapped mana
 * available right now?
 *
 * There is no local, order-independent rule for "spend this source on this
 * pip" once twobrid pips are in play, because the right choice depends on
 * what *else* wants that source. A twobrid pip is only worth spending a
 * colour source on if some other pip has no fallback — and that can only be
 * answered by actually trying both options and checking whether the rest of
 * the cost still lines up. So this is an exact decision, not a heuristic:
 *
 *   1. Phyrexian pips are dropped first — paying 2 life is always available,
 *      so a phyrexian pip never fails and never consumes a source.
 *   2. {C} pips fold into the generic total — see the note on
 *      `Pip["colorless"]` above.
 *   3. Every twobrid pip is *either* a colour-demanding pip for its named
 *      colour, *or* 2 generic — two options each, so this enumerates every
 *      subset of "which twobrid pips are paid as generic" (capped — see
 *      `MAX_ENUMERATED_TWOBRIDS`) and checks each one.
 *   4. For a given subset, every remaining colour-demanding pip (plain,
 *      hybrid, or a twobrid not in the subset) must be matched to a *distinct*
 *      source that produces one of its colours. That is a maximum bipartite
 *      matching (Kuhn's algorithm, `maxMatch`/`tryAugment` above) — not a
 *      greedy pick, because the correct assignment sometimes only exists by
 *      *reassigning* a source another pip was already holding. `{W}{U}{B}`
 *      from a UB dual and two WU duals is exactly this: the greedy this
 *      replaced would burn the only black source on a flexible {U} pip and
 *      then fail {B}; an augmenting path un-does that assignment and gives
 *      the WU dual to {U} instead, freeing the UB dual for {B}.
 *   5. A subset is payable if it produces a perfect match *and* the sources
 *      left unmatched cover that subset's generic total (the cost's own
 *      generic, plus 2 per twobrid paid as generic). The whole cost is
 *      payable if any subset is.
 */
export function canPay(cost: ParsedCost, sources: Color[][]): boolean {
  let genericBase = cost.generic;
  const colorPips: Color[][] = [];
  const twobridColors: Color[][] = [];

  for (const pip of cost.pips) {
    switch (pip.kind) {
      case "phyrexian":
        break;
      case "colorless":
        genericBase += 1;
        break;
      case "twobrid":
        twobridColors.push([pip.color]);
        break;
      case "color":
        colorPips.push(pip.colors);
        break;
    }
  }

  const enumerated = Math.min(twobridColors.length, MAX_ENUMERATED_TWOBRIDS);
  const forcedGeneric = twobridColors.length - enumerated;
  genericBase += 2 * forcedGeneric; // beyond the cap: always priced as generic

  ensureDemandingScratch(colorPips.length + enumerated);
  const subsetCount = 1 << enumerated;

  for (let mask = 0; mask < subsetCount; mask++) {
    let pipCount = 0;
    for (const colors of colorPips) demandingScratch[pipCount++] = colors;

    let genericAsTwobrid = 0;
    for (let i = 0; i < enumerated; i++) {
      if ((mask >> i) & 1) genericAsTwobrid++;
      else demandingScratch[pipCount++] = twobridColors[i];
    }

    if (pipCount > sources.length) continue; // can't match more pips than sources exist

    if (maxMatch(demandingScratch, pipCount, sources) === pipCount) {
      const genericNeeded = genericBase + 2 * genericAsTwobrid;
      const sourcesLeft = sources.length - pipCount;
      if (sourcesLeft >= genericNeeded) return true;
    }
  }

  return false;
}
