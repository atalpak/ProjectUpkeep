/**
 * Read-only selectors over GameState (board/selectors.ts).
 *
 * Run with: npx tsx --test scripts/playtest-board-selectors.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { getBattlefieldGroups, getCard, getZone, recentLog, zoneCount } from "../src/lib/playtest/board/selectors";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";

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
  let next = applyCommand(state, { type: "MOVE_CARD", cardId: a, to: "battlefield", index: null, groupId: "g1" });
  next = applyCommand(next, { type: "MOVE_CARD", cardId: b, to: "battlefield", index: null, groupId: "g1" });
  next = applyCommand(next, { type: "MOVE_CARD", cardId: c, to: "battlefield", index: null, groupId: null });

  const groups = getBattlefieldGroups(next);
  assert.equal(groups.get("g1")?.length, 2);
  assert.equal(groups.get(null)?.length, 1);
});

test("recentLog returns the most recent entries, capped to the requested count", () => {
  let state = fixtureSixtyCardStart();
  for (let i = 0; i < 5; i++) state = applyCommand(state, { type: "NEXT_TURN" });
  const last2 = recentLog(state, 2);
  assert.equal(last2.length, 2);
  assert.deepEqual(last2, state.log.slice(-2));
});
