/**
 * The London mulligan flow and the format start rules, now in the core
 * (MULLIGAN / KEEP) rather than in PlayBoard. These are the format tests the
 * guide asks for: Commander and partners start outside the library, a
 * seven-card London flow bottoms EXACTLY the required number, the free
 * mulligan is an explicit option (never assumed), and the turn-zero draw
 * follows the chosen policy.
 *
 * Run with: npx tsx --test scripts/playtest-board-mulligan.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { bottomsRequired } from "../src/lib/playtest/board/reducers/zones";
import { defaultConfig, suggestFormat } from "../src/lib/playtest/board/format";
import { fixtureCommanderStart, fixtureOpeningHand } from "../src/lib/playtest/board/fixtures";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import type { GameState } from "../src/lib/playtest/board/types";

function mulliganTimes(state: GameState, n: number): GameState {
  let next = state;
  for (let i = 0; i < n; i++) next = applyCommand(next, { type: "MULLIGAN", seed: 100 + i });
  return next;
}

test("a mulligan returns the whole hand, reshuffles with the carried seed, and deals seven", () => {
  const start = fixtureOpeningHand();
  const handBefore = [...start.zones.hand];
  const next = applyCommand(start, { type: "MULLIGAN", seed: 5 });
  assert.equal(next.zones.hand.length, 7);
  assert.equal(next.zones.library.length, 53);
  assert.equal(next.opening.mulligans, 1);
  assert.equal(next.opening.status, "deciding");
  assert.notDeepEqual(next.zones.hand, handBefore, "a fresh seven (overwhelmingly likely for a 60-card deck)");
  assert.deepEqual(checkInvariants(next), []);
  // Same seed, same new hand: the mulligan is replayable.
  assert.deepEqual(applyCommand(start, { type: "MULLIGAN", seed: 5 }).zones.hand, next.zones.hand);
  assert.notDeepEqual(applyCommand(start, { type: "MULLIGAN", seed: 6 }).zones.hand, next.zones.hand);
});

test("keeping the first seven bottoms nothing", () => {
  const start = fixtureOpeningHand();
  assert.equal(bottomsRequired(start), 0);
  const kept = applyCommand(start, { type: "KEEP", bottomIds: [] });
  assert.equal(kept.opening.status, "kept");
  assert.equal(kept.zones.hand.length, 7);
});

test("after n paid mulligans Keep bottoms exactly n cards, in the order chosen", () => {
  for (const n of [1, 2, 3, 4]) {
    const state = mulliganTimes(fixtureOpeningHand(), n);
    assert.equal(bottomsRequired(state), n);
    const hand = state.zones.hand;
    const chosen = hand.slice(0, n).reverse();

    // The wrong count is refused outright: no partial keep.
    if (n > 0) assert.equal(applyCommand(state, { type: "KEEP", bottomIds: chosen.slice(1) }), state, `n=${n}: too few refused`);
    assert.equal(applyCommand(state, { type: "KEEP", bottomIds: [...chosen, hand[n]] }), state, `n=${n}: too many refused`);

    const kept = applyCommand(state, { type: "KEEP", bottomIds: chosen });
    assert.equal(kept.zones.hand.length, 7 - n);
    assert.deepEqual(kept.zones.library.slice(-n), chosen, `n=${n}: bottom of the library is the chosen order, last chosen deepest`);
    assert.equal(kept.opening.status, "kept");
    assert.deepEqual(checkInvariants(kept), []);
  }
});

test("Keep refuses a card that is not in hand and a repeated card", () => {
  const state = mulliganTimes(fixtureOpeningHand(), 2);
  const [a] = state.zones.hand;
  assert.equal(applyCommand(state, { type: "KEEP", bottomIds: [a, a] }), state);
  assert.equal(applyCommand(state, { type: "KEEP", bottomIds: [a, state.zones.library[0]] }), state);
  assert.equal(applyCommand(state, { type: "KEEP", bottomIds: [a, "ghost"] }), state);
});

test("the free-mulligan option is explicit: off by default, and when on the first mulligan bottoms nothing", () => {
  assert.equal(defaultConfig("commander").freeMulligan, "none", "never assumed silently");

  const paid = mulliganTimes(fixtureOpeningHand(), 1);
  assert.equal(bottomsRequired(paid), 1);

  const free = mulliganTimes(fixtureOpeningHand({ freeMulligan: "first" }), 1);
  assert.equal(bottomsRequired(free), 0, "the first mulligan is free");
  assert.equal(applyCommand(free, { type: "KEEP", bottomIds: [] }).zones.hand.length, 7);

  const freeThenPaid = mulliganTimes(fixtureOpeningHand({ freeMulligan: "first" }), 3);
  assert.equal(bottomsRequired(freeThenPaid), 2, "three mulligans, one free: bottom two");
});

test("mulligan and keep are refused once the hand has been kept", () => {
  const kept = applyCommand(fixtureOpeningHand(), { type: "KEEP", bottomIds: [] });
  assert.equal(applyCommand(kept, { type: "MULLIGAN", seed: 1 }), kept);
  assert.equal(applyCommand(kept, { type: "KEEP", bottomIds: [] }), kept);
});

test("mulligan down to nothing is bounded: bottoms are capped at the hand size", () => {
  const tiny = { ...fixtureOpeningHand(), opening: { status: "deciding" as const, mulligans: 9 } };
  assert.equal(bottomsRequired(tiny), 7, "cannot bottom more cards than are in hand");
});

test("commander and partner cards start outside the library, whatever the deck size", () => {
  const state = fixtureCommanderStart();
  assert.equal(state.zones.command.length, 1);
  assert.equal(state.zones.library.length, 99);
  assert.ok(!state.zones.library.includes(state.zones.command[0]));
  assert.equal(state.config.format, "commander");
  assert.equal(state.trackers.life, 40);
});

test("format suggestion follows the commander but is only a suggestion", () => {
  assert.equal(suggestFormat(0), "constructed");
  assert.equal(suggestFormat(1), "commander");
  assert.equal(suggestFormat(2), "commander");
  assert.equal(defaultConfig("constructed").startingLife, 20);
});

test("the turn-zero draw follows the chosen policy: on the play skips the first draw, on the draw takes it", () => {
  const onPlay = applyCommand(applyCommand(fixtureOpeningHand(), { type: "KEEP", bottomIds: [] }), { type: "NEXT_TURN" });
  assert.equal(onPlay.turn, 1);
  assert.equal(onPlay.zones.hand.length, 7, "no draw on the play");

  const onDraw = applyCommand(applyCommand(fixtureOpeningHand({ firstTurnDraws: true }), { type: "KEEP", bottomIds: [] }), { type: "NEXT_TURN" });
  assert.equal(onDraw.zones.hand.length, 8);

  const turn2 = applyCommand(onPlay, { type: "NEXT_TURN" });
  assert.equal(turn2.zones.hand.length, 8, "turn two always draws");
});

test("a small library still mulligans without duplicating or losing cards", () => {
  let state = fixtureOpeningHand();
  state = { ...state, zones: { ...state.zones, library: state.zones.library.slice(0, 2) }, cards: Object.fromEntries(Object.entries(state.cards).filter(([id]) => state.zones.hand.includes(id) || state.zones.library.slice(0, 2).includes(id))) };
  const total = Object.keys(state.cards).length;
  const next = applyCommand(state, { type: "MULLIGAN", seed: 3 });
  assert.equal(Object.values(next.zones).flat().length, total);
  assert.deepEqual(checkInvariants(next), []);
});
