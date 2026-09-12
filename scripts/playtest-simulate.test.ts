/**
 * simulate() and cardByTurnOdds().
 *
 * The invariant tests lean on two degenerate decks with knowable answers
 * (per the brief): an all-land deck and a landless deck. Both are
 * deterministic under the default keep rule regardless of shuffle order —
 * every hand from an all-land 60-card deck has exactly 7 lands, and every
 * hand from a landless one has exactly 0 — so these assert exact numbers,
 * not "close to".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultKeepRule } from "../src/lib/playtest/keep";
import { parseCost, producedColors, type Color } from "../src/lib/playtest/mana";
import type { PlaytestCard } from "../src/lib/playtest/library";
import { cardByTurnOdds, simulate, type SimDeck } from "../src/lib/playtest/simulate";

function makeLand(name: string, colors: Color[], key = name): PlaytestCard {
  return {
    key,
    name,
    typeLine: "Basic Land",
    manaCost: null,
    cmc: 0,
    land: true,
    cost: parseCost(null),
    produces: producedColors({ produced_mana: colors, type_line: "Land" }),
    imageUri: null,
  };
}

function makeSpell(name: string, cost: string, key = name): PlaytestCard {
  return {
    key,
    name,
    typeLine: "Instant",
    manaCost: cost,
    cmc: parseCost(cost).generic + parseCost(cost).pips.length,
    land: false,
    cost: parseCost(cost),
    produces: [],
    imageUri: null,
  };
}

function repeat<T>(item: (i: number) => T, count: number): T[] {
  return Array.from({ length: count }, (_, i) => item(i));
}

test("an all-land 60-card deck: 7-land openers always, and the default rule never keeps", () => {
  const library = repeat((i) => makeLand("Forest", ["G"], `forest-${i}`), 60);
  const deck: SimDeck = { library, commander: null };

  const stats = simulate(deck, {
    hands: 200,
    turns: 5,
    onThePlay: true,
    rule: defaultKeepRule(60),
    seed: 1,
  });

  assert.equal(stats.openingLandDistribution[7], 1);
  assert.ok(stats.openingLandDistribution.slice(0, 7).every((p) => p === 0));
  assert.equal(stats.keepRate, 0);
  assert.equal(stats.colorScrewRate, 0);
});

test("a 60-card deck with no lands at all never keeps", () => {
  const library = repeat((i) => makeSpell("Bear", "{1}{G}", `bear-${i}`), 60);
  const deck: SimDeck = { library, commander: null };

  const stats = simulate(deck, {
    hands: 200,
    turns: 5,
    onThePlay: true,
    rule: defaultKeepRule(60),
    seed: 1,
  });

  assert.equal(stats.openingLandDistribution[0], 1);
  assert.equal(stats.keepRate, 0);
  assert.equal(stats.castByTurn[stats.castByTurn.length - 1], 0);
});

test("mulliganDistribution and openingLandDistribution are each real distributions", () => {
  const library = [
    ...repeat((i) => makeLand("Forest", ["G"], `forest-${i}`), 24),
    ...repeat((i) => makeSpell("Bear", "{1}{G}", `bear-${i}`), 36),
  ];
  const deck: SimDeck = { library, commander: null };

  const stats = simulate(deck, {
    hands: 500,
    turns: 4,
    onThePlay: true,
    rule: defaultKeepRule(60),
    seed: 99,
  });

  const mulliganTotal = Object.values(stats.mulliganDistribution).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(mulliganTotal - 1) < 1e-9);

  const openingTotal = stats.openingLandDistribution.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(openingTotal - 1) < 1e-9);

  // castByTurn is cumulative and therefore non-decreasing.
  for (let i = 1; i < stats.castByTurn.length; i++) {
    assert.ok(stats.castByTurn[i] >= stats.castByTurn[i - 1]);
  }
});

test("a deck with only red sources and only blue spells is always colour-screwed once kept", () => {
  const library = [
    ...repeat((i) => makeLand("Mountain", ["R"], `mtn-${i}`), 30),
    ...repeat((i) => makeSpell("Counterspell", "{U}{U}", `ctr-${i}`), 30),
  ];
  const deck: SimDeck = { library, commander: null };

  const stats = simulate(deck, {
    hands: 300,
    turns: 6,
    onThePlay: true,
    rule: { minLands: 2, maxLands: 5, requireCastableByTurn: null },
    seed: 5,
  });

  // requireCastableByTurn is null, so land count alone can produce a keep —
  // and every kept hand is holding an uncastable blue spell with plenty of
  // (wrong-coloured) mana by the final turn.
  assert.ok(stats.keepRate > 0);
  assert.ok(stats.colorScrewRate > 0.9);
});

test("same seed, same stats", () => {
  const library = [
    ...repeat((i) => makeLand("Forest", ["G"], `forest-${i}`), 24),
    ...repeat((i) => makeSpell("Bear", "{1}{G}", `bear-${i}`), 36),
  ];
  const deck: SimDeck = { library, commander: null };
  const opts = {
    hands: 300,
    turns: 4,
    onThePlay: true,
    rule: defaultKeepRule(60),
    seed: 2026,
  } as const;

  assert.deepEqual(simulate(deck, opts), simulate(deck, opts));
});

test("a commander is always payable eventually and contributes a commanderTurn distribution", () => {
  const library = repeat((i) => makeLand("Forest", ["G"], `forest-${i}`), 40);
  const commander = makeSpell("Commander", "{G}{G}", "cmdr");
  const deck: SimDeck = { library, commander };

  const stats = simulate(deck, {
    hands: 100,
    turns: 5,
    onThePlay: true,
    rule: { minLands: 0, maxLands: 40, requireCastableByTurn: null },
    seed: 3,
  });

  assert.ok(stats.commanderTurn !== null);
  const total = stats.commanderTurn!.byTurn.reduce((a, b) => a + b, 0) + stats.commanderTurn!.never;
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("no commander means no commanderTurn distribution", () => {
  const library = repeat((i) => makeLand("Forest", ["G"], `forest-${i}`), 40);
  const deck: SimDeck = { library, commander: null };
  const stats = simulate(deck, {
    hands: 10,
    turns: 2,
    onThePlay: true,
    rule: defaultKeepRule(40),
    seed: 1,
  });
  assert.equal(stats.commanderTurn, null);
});

// ---------------------------------------------------------------------------
// cardByTurnOdds — exact, not simulated
// ---------------------------------------------------------------------------

test("cardByTurnOdds matches the exact hypergeometric tail for a single copy", () => {
  const library = [
    makeSpell("Sol Ring", "{1}", "sol-ring"),
    ...repeat((i) => makeSpell("Filler", "{1}", `filler-${i}`), 59),
  ];
  const odds = cardByTurnOdds(library, "sol-ring", 3, true);
  // On the play: turn1 sees 7 cards, turn2 sees 8, turn3 sees 9.
  assert.equal(odds.length, 3);
  assert.ok(odds[0] < odds[1]);
  assert.ok(odds[1] < odds[2]);
  // 1 copy in 60, seen among 7: 7/60.
  assert.ok(Math.abs(odds[0] - 7 / 60) < 1e-9);
});

test("cardByTurnOdds is 0 for a card that is not in the deck", () => {
  const library = repeat((i) => makeSpell("Filler", "{1}", `filler-${i}`), 60);
  const odds = cardByTurnOdds(library, "not-there", 3, true);
  assert.deepEqual(odds, [0, 0, 0]);
});

test("cardByTurnOdds is 1 once every copy has necessarily been seen", () => {
  const library = repeat((i) => makeSpell("Filler", "{1}", `filler-${i}`), 8);
  const odds = cardByTurnOdds(library, "filler-0", 5, true);
  // 8-card deck, opening 7 on the play plus 1 draw a turn: by turn 1 you have
  // already seen all but one card, and by turn 2 you have seen the whole deck.
  assert.ok(Math.abs(odds[1] - 1) < 1e-9);
});
