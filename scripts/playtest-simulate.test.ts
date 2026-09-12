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
import { cardByTurnOdds, copiesByTurnOdds, simulate, type SimDeck } from "../src/lib/playtest/simulate";

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
    manaDataKnown: true,
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
    manaDataKnown: true,
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

// ---------------------------------------------------------------------------
// copiesByTurnOdds — the shared machinery behind cardByTurnOdds, callable
// without an actual card in hand (the "any single copy" figure the card-odds
// picker shows for a singleton deck).
// ---------------------------------------------------------------------------

test("copiesByTurnOdds matches cardByTurnOdds for a genuine single-copy card", () => {
  const library = [
    makeSpell("Sol Ring", "{1}", "sol-ring"),
    ...repeat((i) => makeSpell("Filler", "{1}", `filler-${i}`), 59),
  ];
  const viaCard = cardByTurnOdds(library, "sol-ring", 3, true);
  const direct = copiesByTurnOdds(1, library.length, 3, true);
  assert.deepEqual(direct, viaCard);
});

test("copiesByTurnOdds scales with copy count the same way the exact hypergeometric tail does", () => {
  const oneCopy = copiesByTurnOdds(1, 60, 3, true);
  const fourCopies = copiesByTurnOdds(4, 60, 3, true);
  // More copies of the same population can only raise the odds of holding
  // at least one, turn for turn.
  for (let i = 0; i < oneCopy.length; i++) {
    assert.ok(fourCopies[i] > oneCopy[i]);
  }
});

/**
 * Regression guard for the London mulligan.
 *
 * Under London (the rule since 2019) every mulligan draws a *fresh seven* and
 * the cost is paid afterwards, by putting one card per mulligan on the bottom.
 * Under the old Paris rule you drew one card fewer each time, so a hand got
 * strictly harder to keep as you went.
 *
 * A rule demanding six lands makes the two rules diverge sharply. Every London
 * attempt is the same seven-card draw, so four attempts compound:
 *
 *     P(>=6 lands in 7 of 60, 30 lands) = 0.05139
 *     1 - (1 - 0.05139)^4               = 0.1903
 *
 * Paris would draw 7, then 6, then 5, then 4 — and six lands is outright
 * impossible below six cards, so only the first two attempts can ever succeed:
 *
 *     0.05139 + (1 - 0.05139) x 0.01186 = 0.0626
 *
 * Both figures are exact hypergeometric values computed independently of this
 * codebase. The band below admits the first and excludes the second, so
 * "simplifying" the mulligan back to Paris fails this test rather than quietly
 * changing every number the feature reports.
 */
test("mulligans follow the London rule, not the pre-2019 Paris rule", () => {
  const library = [
    ...repeat((i) => makeLand("Plains", ["W"], `plains-${i}`), 30),
    ...repeat((i) => makeSpell("Bolt", "{W}", `bolt-${i}`), 30),
  ];
  const stats = simulate(
    { library, commander: null },
    {
      hands: 20000,
      turns: 3,
      onThePlay: true,
      // Six lands is the point: reachable in seven cards, impossible in five.
      rule: { minLands: 6, maxLands: 7, requireCastableByTurn: null },
      seed: 20260912,
    },
  );

  assert.ok(
    stats.keepRate > 0.17 && stats.keepRate < 0.21,
    `expected the London keep rate of ~0.190, got ${stats.keepRate.toFixed(4)} ` +
      `(the Paris rule would land near 0.063)`,
  );
});
