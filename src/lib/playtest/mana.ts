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
 * Can `cost` be paid from `sources` — the colour sets of the untapped mana
 * available right now?
 *
 * Costs in a real deck are small (at most a handful of coloured pips), so
 * this is a plain greedy assignment rather than a max-flow solver:
 *
 *   1. Phyrexian pips are dropped first. Paying 2 life is always an option,
 *      so a phyrexian pip never fails and never consumes a source — it is
 *      "the cheapest payable option" the module header promises.
 *   2. Every colour-constrained pip (a plain colour, a hybrid, or a twobrid
 *      trying for its colour before falling back to generic) is matched
 *      against the sources that could pay it. At each step the *most
 *      constrained remaining pip* — the one with the fewest matching sources
 *      left — is assigned first, to a source picked for having the fewest
 *      other colours (so flexible multi-colour sources stay free for later
 *      pips). Recomputing "most constrained" after every assignment, rather
 *      than sorting once up front, is what makes a hand like {W}{U}{B} with
 *      three duals — two WU, one UB — resolve correctly: fixing the only
 *      black source to the {B} pip before either flexible pip claims it is
 *      the entire trick.
 *   3. A twobrid pip with no matching source left is not a failure: it falls
 *      back to 2 generic, exactly as printed.
 *   4. {C} pips are folded into the generic total — see the note on
 *      `Pip["colorless"]` above.
 *   5. Whatever sources remain after all of that must cover the generic
 *      total.
 */
export function canPay(cost: ParsedCost, sources: Color[][]): boolean {
  const pool = sources.map((colors) => ({ colors, used: false }));
  let genericNeeded = cost.generic;

  type Constrained = { colors: Color[]; twobrid: boolean };
  const pending: Constrained[] = [];

  for (const pip of cost.pips) {
    if (pip.kind === "phyrexian") continue; // always payable, consumes nothing
    if (pip.kind === "colorless") {
      genericNeeded += 1;
      continue;
    }
    if (pip.kind === "twobrid") {
      pending.push({ colors: [pip.color], twobrid: true });
      continue;
    }
    pending.push({ colors: pip.colors, twobrid: false });
  }

  const matchCount = (pip: Constrained) =>
    pool.filter((s) => !s.used && s.colors.some((c) => pip.colors.includes(c))).length;

  const remaining = [...pending];
  while (remaining.length > 0) {
    // Most constrained first: fewest matching sources, ties broken by fewer
    // candidate colours, ties after that by original order (stable sort).
    remaining.sort((a, b) => matchCount(a) - matchCount(b) || a.colors.length - b.colors.length);
    const pip = remaining.shift()!;
    const matches = pool.filter((s) => !s.used && s.colors.some((c) => pip.colors.includes(c)));

    if (matches.length === 0) {
      if (pip.twobrid) {
        genericNeeded += 2;
        continue;
      }
      return false;
    }

    // Spend the least flexible matching source, leaving multi-colour sources
    // free for whatever pip is still waiting.
    matches.sort((a, b) => a.colors.length - b.colors.length);
    matches[0].used = true;
  }

  const sourcesLeft = pool.filter((s) => !s.used).length;
  return sourcesLeft >= genericNeeded;
}
