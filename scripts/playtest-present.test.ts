/**
 * Presentation helpers for the Playtest UI: formatting, hand-evaluation copy,
 * chart bucketing, and the two gap-analysis rankings. Pure by construction —
 * see the module header on src/lib/playtest/present.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { HandEvaluation, KeepRule } from "../src/lib/playtest/keep";
import { parseCost, producedColors } from "../src/lib/playtest/mana";
import type { PlaytestCard } from "../src/lib/playtest/library";
import { mulberry32 } from "../src/lib/playtest/rng";
import {
  clampInt,
  describeHandEvaluation,
  drawOpeningHand,
  formatPercent,
  formatSignedPercentPoints,
  hasReliableColorData,
  landThresholdShares,
  mergeMissingByCard,
  notableLandCounts,
  numberWord,
  peakIndex,
  pluralizeCards,
  rankGapResults,
  selectTopMissing,
  uniqueLibraryCards,
  type GapResult,
  type MissingEntry,
} from "../src/lib/playtest/present";

/**
 * `colors: null` stands in for a card `produced_mana` (migration 32) has not
 * reached yet — `manaDataKnown` follows that, not the resolved `produces`,
 * so a basic passed `null` still resolves its colours off the type line
 * while correctly reporting itself as unsynced. `typeLine` defaults to a
 * basic's so existing callers that only care about colour, not the
 * defect-2 gate, don't need to know about it.
 */
function land(name: string, colors: string[] | null, key = name, typeLine = "Basic Land"): PlaytestCard {
  return {
    key,
    name,
    typeLine,
    manaCost: null,
    cmc: 0,
    land: true,
    cost: parseCost(null),
    produces: producedColors({ produced_mana: colors, type_line: typeLine }),
    manaDataKnown: colors !== null,
    imageUri: null,
  };
}

function spell(name: string, cost: string | null, key = name): PlaytestCard {
  return {
    key,
    name,
    typeLine: "Instant",
    manaCost: cost,
    cmc: parseCost(cost).generic + parseCost(cost).pips.length,
    land: false,
    cost: parseCost(cost),
    produces: [],
    manaDataKnown: true,
    imageUri: null,
  };
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

test("formatPercent rounds to whole percent by default", () => {
  assert.equal(formatPercent(0.4231), "42%");
  assert.equal(formatPercent(1), "100%");
  assert.equal(formatPercent(0), "0%");
});

test("formatPercent honours extra digits", () => {
  assert.equal(formatPercent(0.4231, 1), "42.3%");
});

test("formatSignedPercentPoints signs a swing and rounds to whole points", () => {
  assert.equal(formatSignedPercentPoints(0.071), "+7pp");
  assert.equal(formatSignedPercentPoints(-0.032), "-3pp");
  assert.equal(formatSignedPercentPoints(0), "0pp");
});

test("pluralizeCards", () => {
  assert.equal(pluralizeCards(1), "1 card");
  assert.equal(pluralizeCards(0), "0 cards");
  assert.equal(pluralizeCards(3), "3 cards");
});

test("clampInt rounds and pins into range", () => {
  assert.equal(clampInt(3.6, 0, 7), 4);
  assert.equal(clampInt(-2, 0, 7), 0);
  assert.equal(clampInt(20, 0, 7), 7);
  assert.equal(clampInt(NaN, 0, 7), 0);
});

test("numberWord spells out small counts and falls back past the word list", () => {
  assert.equal(numberWord(0), "zero");
  assert.equal(numberWord(3), "three");
  assert.equal(numberWord(12), "twelve");
  assert.equal(numberWord(13), "13");
});

// ---------------------------------------------------------------------------
// describeHandEvaluation
// ---------------------------------------------------------------------------

const RULE: KeepRule = { minLands: 3, maxLands: 6, requireCastableByTurn: 3 };

test("describeHandEvaluation: too few lands names the floor", () => {
  const evaluation: HandEvaluation = { lands: 1, keep: false, reason: "too-few-lands", castableByTurn: null };
  assert.equal(describeHandEvaluation(evaluation, RULE), "One land, fewer than this rule's minimum of three.");
});

test("describeHandEvaluation: too many lands names the ceiling", () => {
  const evaluation: HandEvaluation = { lands: 7, keep: false, reason: "too-many-lands", castableByTurn: null };
  assert.equal(describeHandEvaluation(evaluation, RULE), "Seven lands, more than this rule's maximum of six.");
});

test("describeHandEvaluation: nothing castable, matching the brief's own example", () => {
  const evaluation: HandEvaluation = { lands: 2, keep: false, reason: "no-castable-spell", castableByTurn: null };
  const rule: KeepRule = { minLands: 0, maxLands: 7, requireCastableByTurn: 3 };
  assert.equal(describeHandEvaluation(evaluation, rule), "Two lands, and nothing castable by turn three.");
});

test("describeHandEvaluation: a keep names the turn something becomes castable", () => {
  const evaluation: HandEvaluation = { lands: 3, keep: true, reason: "ok", castableByTurn: 2 };
  assert.equal(describeHandEvaluation(evaluation, RULE), "Three lands, and something castable by turn two.");
});

test("describeHandEvaluation: a keep with no castability check configured", () => {
  const rule: KeepRule = { minLands: 2, maxLands: 5, requireCastableByTurn: null };
  const evaluation: HandEvaluation = { lands: 4, keep: true, reason: "ok", castableByTurn: null };
  assert.equal(describeHandEvaluation(evaluation, rule), "Four lands, within the two–five land band this rule wants.");
});

// ---------------------------------------------------------------------------
// drawOpeningHand
// ---------------------------------------------------------------------------

test("drawOpeningHand draws seven and continues the same rng across calls", () => {
  const library = Array.from({ length: 40 }, (_, i) => land("Forest", ["G"], `f-${i}`));
  const rng = mulberry32(7);

  const first = drawOpeningHand(library, rng);
  const second = drawOpeningHand(library, rng);

  assert.equal(first.length, 7);
  assert.equal(second.length, 7);
  // Same generator, continuing its sequence — replaying from a fresh
  // mulberry32(7) reproduces the exact same two hands in order.
  const replay = mulberry32(7);
  assert.deepEqual(drawOpeningHand(library, replay), first);
  assert.deepEqual(drawOpeningHand(library, replay), second);
});

test("drawOpeningHand caps at library size for a deck smaller than seven", () => {
  const library = [land("Forest", ["G"]), land("Island", ["U"]), land("Swamp", ["B"])];
  const hand = drawOpeningHand(library, mulberry32(1));
  assert.equal(hand.length, 3);
});

// ---------------------------------------------------------------------------
// Chart support
// ---------------------------------------------------------------------------

test("peakIndex finds the largest value, keeping the earliest index on a tie", () => {
  assert.equal(peakIndex([0.1, 0.5, 0.4]), 1);
  assert.equal(peakIndex([0.3, 0.3, 0.1]), 0);
});

test("notableLandCounts labels the peak plus the rule's min/max, deduped and sorted", () => {
  // Peak at index 4, rule wants 3..6 — 3 and 6 both land inside range 0..7.
  const distribution = [0.01, 0.02, 0.1, 0.2, 0.4, 0.2, 0.06, 0.01];
  const rule: KeepRule = { minLands: 3, maxLands: 6, requireCastableByTurn: 3 };
  assert.deepEqual(notableLandCounts(distribution, rule), [3, 4, 6]);
});

test("notableLandCounts ignores a rule bound outside the chart's range", () => {
  const distribution = [0.1, 0.2, 0.3, 0.4];
  const rule: KeepRule = { minLands: 1, maxLands: 99, requireCastableByTurn: 3 };
  assert.deepEqual(notableLandCounts(distribution, rule), [1, 3]);
});

test("landThresholdShares reads the ragged landsByTurn rows, 0 past what a turn could reach", () => {
  // Turn 1: only "at least 1" exists. Turn 2: "at least 1" and "at least 2".
  const landsByTurn = [[0.9], [0.9, 0.5]];
  const shares = landThresholdShares(landsByTurn, [1, 2]);
  assert.deepEqual(shares, [
    [0.9, 0.9], // at least 1, by turn 1 and turn 2
    [0, 0.5], // at least 2 — impossible by turn 1, so 0
  ]);
});

test("uniqueLibraryCards dedupes by key and sorts by name", () => {
  const library = [spell("Zap", "{R}", "zap"), spell("Bolt", "{R}", "bolt"), spell("Bolt", "{R}", "bolt")];
  const unique = uniqueLibraryCards(library);
  assert.deepEqual(
    unique.map((c) => c.name),
    ["Bolt", "Zap"],
  );
});

test("hasReliableColorData: an all-basics manabase is trustworthy, synced or not", () => {
  const library = [
    land("Forest", ["G"], "forest"),
    land("Plains", null, "plains"), // unsynced, but a basic's type line is enough on its own
    spell("Sol Ring", "{1}", "sol-ring"),
  ];
  assert.equal(hasReliableColorData(library), true);
});

test("hasReliableColorData: a material share of unsynced non-basic lands is not trustworthy", () => {
  const library = [
    land("Forest", ["G"], "f1", "Basic Land"),
    land("Forest", ["G"], "f2", "Basic Land"),
    land("Command Tower", null, "tower", "Land"),
    land("Mana Confluence", null, "confluence", "Land"),
    land("City of Brass", null, "city", "Land"),
  ];
  // 3 of 5 lands are non-basic and unsynced — 60%, well past the 20% bar.
  assert.equal(hasReliableColorData(library), false);
});

test("hasReliableColorData: a fully-synced deck is trustworthy even when most lands are non-basic", () => {
  const library = [
    land("Forest", ["G"], "forest", "Basic Land"),
    land("Command Tower", ["W", "U", "B", "R", "G"], "tower", "Land"),
    land("Mana Confluence", ["W", "U", "B", "R", "G"], "confluence", "Land"),
  ];
  assert.equal(hasReliableColorData(library), true);
});

test("hasReliableColorData: a small, tolerable share of unsynced non-basics doesn't trip the gate", () => {
  const library = [
    ...Array.from({ length: 9 }, (_, i) => land("Forest", ["G"], `f-${i}`, "Basic Land")),
    land("Command Tower", null, "tower", "Land"), // 1 of 10 lands — 10%, under the 20% bar
  ];
  assert.equal(hasReliableColorData(library), true);
});

test("hasReliableColorData: no lands at all means nothing to measure colour screw against", () => {
  const library = [spell("Sol Ring", "{1}", "sol-ring")];
  assert.equal(hasReliableColorData(library), false);
});

// ---------------------------------------------------------------------------
// Gap-analysis rankings
// ---------------------------------------------------------------------------

test("mergeMissingByCard sums shortfalls that share a key, as two printings of the same card would", () => {
  const forestOld = spell("Forest", null, "oracle-forest");
  const forestNew = spell("Forest", null, "oracle-forest");
  const missing: MissingEntry[] = [
    { card: forestOld, count: 5 },
    { card: forestNew, count: 3 },
    { card: spell("Sol Ring", "{1}", "sol-ring"), count: 1 },
  ];
  const merged = mergeMissingByCard(missing);
  assert.equal(merged.length, 2);
  const forest = merged.find((m) => m.card.key === "oracle-forest");
  assert.equal(forest?.count, 8);
  // The first-seen printing stands in for the merged entry.
  assert.equal(forest?.card, forestOld);
});

test("mergeMissingByCard leaves distinct cards alone", () => {
  const missing: MissingEntry[] = [
    { card: spell("A", null, "a"), count: 2 },
    { card: spell("B", null, "b"), count: 3 },
  ];
  assert.deepEqual(
    mergeMissingByCard(missing).map((m) => m.count),
    [2, 3],
  );
});

test("selectTopMissing picks the biggest shortfalls, highest count first", () => {
  const missing: MissingEntry[] = [
    { card: spell("A", null, "a"), count: 2 },
    { card: spell("B", null, "b"), count: 8 },
    { card: spell("C", null, "c"), count: 5 },
  ];
  const top = selectTopMissing(missing, 2);
  assert.deepEqual(
    top.map((m) => m.card.name),
    ["B", "C"],
  );
});

test("selectTopMissing never returns more than the cap", () => {
  const missing: MissingEntry[] = [
    { card: spell("A", null, "a"), count: 1 },
    { card: spell("B", null, "b"), count: 1 },
  ];
  assert.equal(selectTopMissing(missing, 12).length, 2);
});

test("rankGapResults orders by keep-rate swing, biggest first", () => {
  const results: GapResult[] = [
    { card: spell("A", null, "a"), missingCount: 2, deltaKeepRate: 0.02 },
    { card: spell("B", null, "b"), missingCount: 4, deltaKeepRate: 0.11 },
    { card: spell("C", null, "c"), missingCount: 1, deltaKeepRate: -0.01 },
  ];
  assert.deepEqual(
    rankGapResults(results).map((r) => r.card.name),
    ["B", "A", "C"],
  );
});
