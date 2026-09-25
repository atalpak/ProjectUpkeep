/**
 * Read-only selectors over GameState (board/selectors.ts).
 *
 * Run with: npx tsx --test scripts/playtest-board-selectors.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { getBattlefieldGroups, getCard, getZone, isDirty, recentEvents, selectionTotals, zoneCount } from "../src/lib/playtest/board/selectors";
import { fixtureOpeningHand, fixtureSixtyCardStart, makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";

test("getZone resolves ids to their card objects in zone order", () => {
  const state = fixtureSixtyCardStart();
  const cards = getZone(state, "library");
  assert.equal(cards.length, 60);
  assert.equal(cards[0].id, state.zones.library[0]);
});

test("zoneCount matches the zone's id list length", () => {
  const state = fixtureSixtyCardStart();
  assert.equal(zoneCount(state, "library"), 60);
  assert.equal(zoneCount(state, "hand"), 0);
});

test("getCard returns null for an unknown id", () => {
  const state = fixtureSixtyCardStart();
  assert.equal(getCard(state, "nope"), null);
});

test("getBattlefieldGroups groups cards by groupId, ungrouped under null", () => {
  const state = fixtureSixtyCardStart();
  const [a, b, c] = state.zones.library;
  let next = applyCommand(state, { type: "MOVE_MANY", ids: [a, b, c], to: "battlefield", at: "bottom" });
  next = applyCommand(next, { type: "SET_GROUP", ids: [a, b], groupId: "g1", group: { label: "Pair" } });

  const groups = getBattlefieldGroups(next);
  assert.equal(groups.get("g1")?.length, 2);
  assert.equal(groups.get(null)?.length, 1);
});

test("recentEvents returns the most recent entries, capped, and hides voided ones", () => {
  let state = fixtureSixtyCardStart();
  state = applyCommand(state, { type: "NEXT_TURN" });
  for (let i = 0; i < 4; i++) state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: 20 - (i + 1) });
  const last2 = recentEvents(state, 2);
  assert.equal(last2.length, 2);
  assert.deepEqual(last2, state.events.slice(-2));

  const voided = applyCommand(state, { type: "VOID_EVENT", seq: state.events[state.events.length - 1].seq, voided: true });
  assert.equal(recentEvents(voided, 2).length, 2);
  assert.ok(!recentEvents(voided, 2).some((e) => e.seq === state.events[state.events.length - 1].seq));
});

test("selectionTotals adds displayed power and toughness including offsets and +1/+1 counters", () => {
  const a = makeGameCard("a", "A", { power: "2", toughness: "3", ptOffset: { power: 1, toughness: 0 }, counters: { "+1/+1": 2 } });
  const b = makeGameCard("b", "B", { power: "*", toughness: "1" });
  const state = makeState([a, b], { battlefield: ["a", "b"] });
  const totals = selectionTotals(state, ["a", "b", "ghost"]);
  assert.equal(totals.count, 2);
  assert.equal(totals.power, 2 + 1 + 2 + 0);
  assert.equal(totals.toughness, 3 + 0 + 2 + 1);
});

test("isDirty is false while only mulliganing and true after the first real action", () => {
  let state = fixtureOpeningHand();
  assert.equal(isDirty(state), false);
  state = applyCommand(state, { type: "MULLIGAN", seed: 5 });
  assert.equal(isDirty(state), false);
  state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: 15 });
  assert.equal(isDirty(state), true);
});
