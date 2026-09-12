/**
 * The keep/mulligan heuristic.
 *
 * Covers the land-count bands, the two deck-size defaults, and the
 * turn-order castability check (playing lands in hand order, per the file's
 * documented simplification).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultKeepRule, evaluateHand, type KeepRule } from "../src/lib/playtest/keep";
import { parseCost, producedColors } from "../src/lib/playtest/mana";
import type { PlaytestCard } from "../src/lib/playtest/library";

function land(colors: string[]): PlaytestCard {
  return {
    key: `land-${colors.join("")}-${Math.random()}`,
    name: "Land",
    typeLine: "Land",
    manaCost: null,
    cmc: 0,
    land: true,
    cost: parseCost(null),
    produces: producedColors({ produced_mana: colors, type_line: "Land" }),
    manaDataKnown: true,
    imageUri: null,
  };
}

function spell(name: string, cost: string | null, cmc: number): PlaytestCard {
  return {
    key: `spell-${name}`,
    name,
    typeLine: "Instant",
    manaCost: cost,
    cmc,
    land: false,
    cost: parseCost(cost),
    produces: [],
    manaDataKnown: true,
    imageUri: null,
  };
}

const RULE_60: KeepRule = { minLands: 2, maxLands: 5, requireCastableByTurn: 3 };

test("defaultKeepRule: 60-card band", () => {
  assert.deepEqual(defaultKeepRule(60), { minLands: 2, maxLands: 5, requireCastableByTurn: 3 });
});

test("defaultKeepRule: Commander-sized band", () => {
  assert.deepEqual(defaultKeepRule(99), { minLands: 3, maxLands: 6, requireCastableByTurn: 3 });
  assert.deepEqual(defaultKeepRule(100), { minLands: 3, maxLands: 6, requireCastableByTurn: 3 });
});

test("too few lands is rejected before castability is even checked", () => {
  const hand = [land(["W"]), spell("Bolt", "{R}", 1), spell("Bolt2", "{R}", 1), spell("Bolt3", "{R}", 1)];
  const result = evaluateHand(hand, RULE_60);
  assert.equal(result.reason, "too-few-lands");
  assert.equal(result.keep, false);
  assert.equal(result.castableByTurn, null);
});

test("too many lands is rejected", () => {
  const hand = Array.from({ length: 6 }, () => land(["G"]));
  const result = evaluateHand(hand, RULE_60);
  assert.equal(result.reason, "too-many-lands");
  assert.equal(result.keep, false);
});

test("a hand with the right land count but nothing castable by the deadline is rejected", () => {
  const hand = [land(["W"]), land(["W"]), spell("Counterspell", "{U}{U}", 2)];
  const result = evaluateHand(hand, RULE_60);
  assert.equal(result.reason, "no-castable-spell");
  assert.equal(result.keep, false);
});

test("a keepable hand reports the turn its first castable spell lands", () => {
  // 2 lands, one Mountain-producing, a 1-drop that needs R: castable turn 1.
  const hand = [land(["R"]), land(["W"]), spell("Shock", "{R}", 1)];
  const result = evaluateHand(hand, RULE_60);
  assert.equal(result.keep, true);
  assert.equal(result.reason, "ok");
  assert.equal(result.castableByTurn, 1);
});

test("castability respects hand order: lands play in the order given", () => {
  // Same two lands, same one spell, only the order in the hand differs. The
  // documented simplification is that lands are assumed played in hand
  // order rather than resequenced for colour, so which turn a {U} spell
  // becomes payable depends on where the Island-producing land sits.
  const uSpell = spell("Counterspell", "{U}", 1);

  const islandSecond = evaluateHand([land(["R"]), land(["U"]), uSpell], RULE_60);
  assert.equal(islandSecond.castableByTurn, 2);

  const islandFirst = evaluateHand([land(["U"]), land(["R"]), uSpell], RULE_60);
  assert.equal(islandFirst.castableByTurn, 1);
});

test("requireCastableByTurn: null skips the castability check entirely", () => {
  const rule: KeepRule = { minLands: 2, maxLands: 5, requireCastableByTurn: null };
  const hand = [land(["W"]), land(["W"]), spell("Counterspell", "{U}{U}", 2)];
  const result = evaluateHand(hand, rule);
  assert.equal(result.keep, true);
  assert.equal(result.reason, "ok");
});

test("a hand with no lands and only a free spell is still castable turn 1", () => {
  const free = spell("Ornithopter", null, 0);
  const rule: KeepRule = { minLands: 0, maxLands: 5, requireCastableByTurn: 3 };
  const result = evaluateHand([free], rule);
  assert.equal(result.keep, true);
  assert.equal(result.castableByTurn, 1);
});
