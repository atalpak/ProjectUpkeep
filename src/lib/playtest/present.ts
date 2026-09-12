/**
 * Presentation-only helpers for the Playtest page.
 *
 * None of this touches the engine (mana.ts / library.ts / odds.ts / rng.ts /
 * keep.ts / simulate.ts) — it exists so the *component* code does not grow its
 * own scattered formatting and ranking logic inline, per the house rule that a
 * pure helper written for a UI gets a module and a test rather than living in
 * the JSX. Three kinds of thing live here: turning a fraction into copy a
 * player reads at a table, picking which points on a chart are worth a label,
 * and the two rankings the "what's the gap costing me" feature needs (which
 * missing cards are worth the expense of re-simulating, and how to order what
 * comes back).
 */

import type { KeepRule } from "@/lib/playtest/keep";
import type { HandEvaluation } from "@/lib/playtest/keep";
import type { PlaytestCard } from "@/lib/playtest/library";
import type { RNG } from "@/lib/playtest/rng";
import { shuffle } from "@/lib/playtest/rng";

// ---------------------------------------------------------------------------
// Numbers, in words a player reads rather than a UI reads
// ---------------------------------------------------------------------------

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * A keep-rate delta as "+7pp" / "-3pp" — the shorthand the gap-analysis list
 * uses for "this many percentage points of keep rate," never confused with a
 * plain percent because the swing is always signed and always whole points
 * (3,000-hand samples do not warrant a decimal).
 */
export function formatSignedPercentPoints(deltaFraction: number): string {
  const points = Math.round(deltaFraction * 100);
  if (points === 0) return "0pp";
  return points > 0 ? `+${points}pp` : `${points}pp`;
}

export function pluralizeCards(count: number): string {
  return `${count} card${count === 1 ? "" : "s"}`;
}

/** Rounds to the nearest integer and pins it inside `[min, max]` — the keep
 *  rule editor's three number inputs all funnel through this rather than
 *  trusting whatever a `<input type="number">` hands back on blur. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/** Spells out small counts ("three lands" reads better at a table than "3
 *  lands"); falls back to the numeral once a hand or a turn count runs past
 *  what anyone would actually say the word for. */
export function numberWord(n: number): string {
  if (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length) return NUMBER_WORDS[n];
  return String(n);
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

/**
 * The plain-language reason behind an `evaluateHand` verdict — what the
 * keep/mulligan badge in the UI is standing next to. Deliberately says only
 * the "why," not "keep" or "mulligan": the caller already has `evaluation.keep`
 * and renders that as its own badge, so this never has to agree with itself
 * about which word means what.
 */
export function describeHandEvaluation(evaluation: HandEvaluation, rule: KeepRule): string {
  const lands = capitalize(numberWord(evaluation.lands));
  const landsPhrase = `${lands} land${evaluation.lands === 1 ? "" : "s"}`;

  switch (evaluation.reason) {
    case "too-few-lands":
      return `${landsPhrase}, fewer than this rule's minimum of ${numberWord(rule.minLands)}.`;
    case "too-many-lands":
      return `${landsPhrase}, more than this rule's maximum of ${numberWord(rule.maxLands)}.`;
    case "no-castable-spell":
      return `${landsPhrase}, and nothing castable by turn ${numberWord(rule.requireCastableByTurn ?? 0)}.`;
    case "ok":
      if (evaluation.castableByTurn !== null) {
        return `${landsPhrase}, and something castable by turn ${numberWord(evaluation.castableByTurn)}.`;
      }
      return `${landsPhrase}, within the ${numberWord(rule.minLands)}–${numberWord(rule.maxLands)} land band this rule wants.`;
  }
}

// ---------------------------------------------------------------------------
// Drawing a hand for the interactive draw/mulligan flow
// ---------------------------------------------------------------------------

/**
 * One opening seven, off whatever `rng` currently is.
 *
 * Takes the generator rather than a seed so the draw/mulligan flow can call
 * this repeatedly against the *same* mulberry32 instance — a fresh London
 * mulligan is "shuffle again and draw seven," continuing the one sequence a
 * seed started, not restarting it. See rng.ts's own header for why the
 * simulator needs the same property.
 */
export function drawOpeningHand(library: PlaytestCard[], rng: RNG): PlaytestCard[] {
  const copy = library.slice();
  shuffle(copy, rng);
  return copy.slice(0, Math.min(7, copy.length));
}

// ---------------------------------------------------------------------------
// Chart support
// ---------------------------------------------------------------------------

/** The index of the largest value — the "most likely count" a bar chart
 *  singles out for a label. Ties keep the earliest index. */
export function peakIndex(values: number[]): number {
  let peak = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[peak]) peak = i;
  }
  return peak;
}

/**
 * Which bars of the opening-land-spread chart earn a printed number: the most
 * likely count, plus the keep rule's own min/max lands wherever those land
 * inside the chart's range. Everything else stays unlabeled — "direct-label
 * only the notable bars," not a number crammed under every one of them.
 */
export function notableLandCounts(distribution: number[], rule: KeepRule): number[] {
  const notable = new Set<number>([peakIndex(distribution)]);
  if (rule.minLands >= 0 && rule.minLands < distribution.length) notable.add(rule.minLands);
  if (rule.maxLands >= 0 && rule.maxLands < distribution.length) notable.add(rule.maxLands);

  return [...notable].sort((a, b) => a - b);
}

/**
 * Reshapes `SimulateStats.landsByTurn` — a ragged array, row `t` only `t+1`
 * entries long — into one flat series per land-count threshold, so the "lands
 * by turn" chart can plot "share of games with 3+ lands" as a single line
 * across every turn without re-deriving the ragged indexing at render time.
 * A threshold past what a turn could possibly reach (more lands than turns
 * played — impossible, since `simulate` plays at most one land a turn) reads
 * as 0 rather than undefined.
 */
export function landThresholdShares(landsByTurn: number[][], thresholds: number[]): number[][] {
  return thresholds.map((threshold) =>
    landsByTurn.map((row) => (threshold <= row.length ? row[threshold - 1] : 0)),
  );
}

/** Every distinct card in a library, one entry each, alphabetical — what the
 *  card-odds picker lists. */
export function uniqueLibraryCards(library: PlaytestCard[]): PlaytestCard[] {
  const seen = new Map<string, PlaytestCard>();
  for (const card of library) {
    if (!seen.has(card.key)) seen.set(card.key, card);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A basic's own name is always in its type line ("Basic Land — Forest"),
 *  which is exactly what `producedColors`'s type-line fallback keys on — so a
 *  basic is trustworthy whether or not it has been synced. Everything else
 *  (duals, Command Tower, the painlands — most of a Commander mana base)
 *  reports zero colours until `produced_mana` actually says otherwise. */
function isBasicLand(card: PlaytestCard): boolean {
  return card.typeLine.split("//")[0].includes("Basic");
}

/**
 * A fifth of a deck's lands being unresolved non-basics is treated as "not
 * enough to trust." Chosen because a Commander mana base is usually majority
 * non-basic, so right after migration 32 ships and before the next Scryfall
 * sync, effectively the whole mana base falls in that bucket and the gate
 * should refuse a number outright; a deck with a couple of freshly-added,
 * not-yet-synced utility lands sitting in an otherwise-synced base should
 * still get its figure rather than losing it to noise.
 */
const UNRESOLVED_NONBASIC_LAND_THRESHOLD = 0.2;

/**
 * Whether the deck's mana base is known well enough to trust a colour-screw
 * measurement.
 *
 * The old gate asked "does *anything* in the library produce a colour" —
 * which is true the moment a single basic is present, i.e. true for nearly
 * every deck regardless of sync state, because `producedColors`'s type-line
 * fallback gets basics right with or without `produced_mana` (migration 32).
 * That fallback does *not* help a named fixer: a dual or a Command Tower with
 * no synced `produced_mana` yet silently produces nothing, so a deck can be
 * mostly invisible fixing and still pass the old check on the strength of its
 * Forests. This instead measures what share of the deck's *lands* are
 * non-basic and still unresolved (see `PlaytestCard.manaDataKnown`), and
 * refuses the figure once that share is material — see
 * `UNRESOLVED_NONBASIC_LAND_THRESHOLD`. A deck with no lands at all has
 * nothing to measure colour screw against either, so that counts as
 * unreliable too.
 */
export function hasReliableColorData(library: PlaytestCard[]): boolean {
  const lands = library.filter((card) => card.land);
  if (lands.length === 0) return false;

  const unresolvedNonBasics = lands.filter((card) => !isBasicLand(card) && !card.manaDataKnown).length;
  return unresolvedNonBasics / lands.length < UNRESOLVED_NONBASIC_LAND_THRESHOLD;
}

// ---------------------------------------------------------------------------
// "What the missing cards are costing you"
// ---------------------------------------------------------------------------

export type MissingEntry = { card: PlaytestCard; count: number };

/**
 * Collapses `buildLibrary`'s `missing` list to one entry per distinct card.
 *
 * A card listed under two printings (see library.ts's own header on the
 * Forest example) can come back as two separate shortfalls sharing the same
 * `key` once the shared sleeved total runs out partway through the group —
 * real, additive copies missing, just attributed to different printings of
 * the same card. Showing them as two rows would both double up on screen and
 * collide as a React list key, and measuring them separately would ask "what
 * if you had 5 more Forests" and "what if you had 3 more" instead of the one
 * question that matters, "what if you had all 8." First-seen printing stands
 * in for the card in the merged entry — which one hardly matters, since a
 * mana-cost/type-line goldfish only ever cares about the card, not the art.
 */
export function mergeMissingByCard(missing: MissingEntry[]): MissingEntry[] {
  const byKey = new Map<string, MissingEntry>();
  for (const entry of missing) {
    const existing = byKey.get(entry.card.key);
    if (existing) existing.count += entry.count;
    else byKey.set(entry.card.key, { card: entry.card, count: entry.count });
  }
  return [...byKey.values()];
}

/** The missing cards worth spending a re-simulation on: the `cap` biggest
 *  shortfalls by copies missing, highest first. Re-running for every missing
 *  card on a large want-list would be a lot of 3,000-hand simulations for
 *  entries that could never move the number much. */
export function selectTopMissing(missing: MissingEntry[], cap: number): MissingEntry[] {
  return [...missing].sort((a, b) => b.count - a.count).slice(0, cap);
}

export type GapResult = {
  card: PlaytestCard;
  missingCount: number;
  deltaKeepRate: number;
};

/** The gap-analysis list, ordered by what actually matters: the biggest keep
 *  rate swing first, not the order the missing cards happened to be found in. */
export function rankGapResults(results: GapResult[]): GapResult[] {
  return [...results].sort((a, b) => b.deltaKeepRate - a.deltaKeepRate);
}
