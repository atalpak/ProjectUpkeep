/**
 * applyCommand: each command changes only what it says it changes, and
 * leaves everything else in `GameState` untouched.
 *
 * Run with: npx tsx --test scripts/playtest-board-reduce.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { fixtureSixtyCardStart, fixtureCommanderStart } from "../src/lib/playtest/board/fixtures";
import type { GameState } from "../src/lib/playtest/board/types";

test("DRAW moves N cards from the top of the library into the hand, in order", () => {
  const state = fixtureSixtyCardStart();
  const top3 = state.zones.library.slice(0, 3);

  const next = applyCommand(state, { type: "DRAW", count: 3 });

  assert.deepEqual(next.zones.hand, top3);
  assert.deepEqual(next.zones.library, state.zones.library.slice(3));
  // Nothing else about the state changed.
  assert.equal(next.trackers.life, state.trackers.life);
  assert.equal(next.turn, state.turn);
  assert.deepEqual(next.zones.battlefield, state.zones.battlefield);
});

test("DRAW is capped at what's left in the library rather than throwing", () => {
  const state = fixtureSixtyCardStart();
  const next = applyCommand(state, { type: "DRAW", count: 1000 });
  assert.equal(next.zones.library.length, 0);
  assert.equal(next.zones.hand.length, 60);
});

test("MOVE_CARD relocates exactly one card and nothing else", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];

  const next = applyCommand(state, { type: "MOVE_CARD", cardId, to: "hand", index: null });

  assert.ok(!next.zones.library.includes(cardId));
  assert.deepEqual(next.zones.hand, [cardId]);
  assert.equal(Object.keys(next.cards).length, Object.keys(state.cards).length);
  for (const id of Object.keys(state.cards)) {
    if (id === cardId) continue;
    assert.deepEqual(next.cards[id], state.cards[id]);
  }
});

test("MOVE_CARD onto the battlefield joins an EXISTING group; leaving it clears group and position", () => {
  const state = fixtureSixtyCardStart();
  const [first, second] = state.zones.library;

  // A group must exist before a card can be moved into it (SET_GROUP creates it).
  const onBoard = applyCommand(state, { type: "MOVE_CARD", cardId: first, to: "battlefield", index: null });
  const grouped = applyCommand(onBoard, { type: "SET_GROUP", ids: [first], groupId: "group-a", group: { label: "Ramp" } });
  const joined = applyCommand(grouped, { type: "MOVE_CARD", cardId: second, to: "battlefield", index: null, groupId: "group-a" });
  assert.equal(joined.cards[second].groupId, "group-a");
  assert.equal(joined.cards[second].pos, null);

  const toGraveyard = applyCommand(joined, { type: "MOVE_CARD", cardId: second, to: "graveyard", index: null });
  assert.equal(toGraveyard.cards[second].groupId, null);
  assert.equal(toGraveyard.cards[second].pos, null);

  // An unknown group id is ignored rather than creating a phantom group.
  const phantom = applyCommand(state, { type: "MOVE_CARD", cardId: first, to: "battlefield", index: null, groupId: "nope" });
  assert.equal(phantom.cards[first].groupId, null);
  assert.notEqual(phantom.cards[first].pos, null);
});

test("leaving the battlefield wipes tapped state, counters and offsets; notes and commander tax survive", () => {
  let state = fixtureSixtyCardStart();
  const id = state.zones.library[0];
  state = applyCommand(state, { type: "MOVE_CARD", cardId: id, to: "battlefield", index: null });
  state = applyCommand(state, { type: "SET_CARD_FLAGS", ids: [id], flags: { tapped: true, ptOffset: { power: 2, toughness: 2 }, commanderTax: 4 } });
  state = applyCommand(state, { type: "ADD_COUNTER", cardId: id, name: "+1/+1", delta: 2 });
  state = applyCommand(state, { type: "SET_NOTE", cardId: id, note: "keep me" });
  state = applyCommand(state, { type: "MOVE_CARD", cardId: id, to: "graveyard", index: null });
  const card = state.cards[id];
  assert.equal(card.tapped, false);
  assert.deepEqual(card.counters, {});
  assert.deepEqual(card.ptOffset, { power: 0, toughness: 0 });
  assert.equal(card.note, "keep me");
  assert.equal(card.commanderTax, 4);
});

test("MOVE_CARD for an unknown card id is a no-op", () => {
  const state = fixtureSixtyCardStart();
  const next = applyCommand(state, { type: "MOVE_CARD", cardId: "does-not-exist", to: "hand", index: null });
  assert.deepEqual(next, state);
});

test("SET_TAPPED flips only the targeted card's tapped flag", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];
  const next = applyCommand(state, { type: "SET_TAPPED", cardId, tapped: true });
  assert.equal(next.cards[cardId].tapped, true);
  const other = state.zones.library[1];
  assert.equal(next.cards[other].tapped, false);
});

test("SET_FACE flips only the targeted card's face", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];
  const next = applyCommand(state, { type: "SET_FACE", cardId, face: "face-down" });
  assert.equal(next.cards[cardId].face, "face-down");
});

test("SET_ROTATION sets only the targeted card's rotation", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];
  const next = applyCommand(state, { type: "SET_ROTATION", cardId, rotation: 90 });
  assert.equal(next.cards[cardId].rotation, 90);
  const other = state.zones.library[1];
  assert.equal(next.cards[other].rotation, 0);
});

test("SET_NOTE sets and clears only the targeted card's note", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];
  const noted = applyCommand(state, { type: "SET_NOTE", cardId, note: "Combo piece" });
  assert.equal(noted.cards[cardId].note, "Combo piece");
  const cleared = applyCommand(noted, { type: "SET_NOTE", cardId, note: null });
  assert.equal(cleared.cards[cardId].note, null);
});

test("ADD_COUNTER adds, and removes the key entirely once it returns to zero", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];

  const plusOne = applyCommand(state, { type: "ADD_COUNTER", cardId, name: "+1/+1", delta: 2 });
  assert.equal(plusOne.cards[cardId].counters["+1/+1"], 2);

  const backToZero = applyCommand(plusOne, { type: "ADD_COUNTER", cardId, name: "+1/+1", delta: -2 });
  assert.equal(backToZero.cards[cardId].counters["+1/+1"], undefined);
  assert.ok(!("+1/+1" in backToZero.cards[cardId].counters));
});

test("CREATE_EXTRA adds new objects without touching deck-card counts or the library", () => {
  const state = fixtureSixtyCardStart();
  const deckCardCountBefore = Object.values(state.cards).filter((c) => c.kind === "deck-card").length;
  const libraryBefore = [...state.zones.library];

  const next = applyCommand(state, {
    type: "CREATE_EXTRA",
    ids: ["token-1", "token-2"],
    spec: { name: "Soldier", power: "1", toughness: "1", imageSmall: null, imageNormal: null },
    kind: "token",
    zone: "battlefield",
  });

  assert.equal(next.zones.battlefield.length, 2);
  assert.equal(next.cards["token-1"].kind, "token");
  assert.equal(next.cards["token-1"].power, "1");
  const deckCardCountAfter = Object.values(next.cards).filter((c) => c.kind === "deck-card").length;
  assert.equal(deckCardCountAfter, deckCardCountBefore);
  assert.deepEqual(next.zones.library, libraryBefore);
});

test("DELETE_OBJECT removes a token without altering deck-card counts or the library", () => {
  const state = fixtureSixtyCardStart();
  const withToken = applyCommand(state, {
    type: "CREATE_EXTRA",
    ids: ["token-1"],
    spec: { name: "Soldier", power: "1", toughness: "1", imageSmall: null, imageNormal: null },
    kind: "token",
    zone: "battlefield",
  });
  const libraryBefore = [...withToken.zones.library];
  const deckCardCountBefore = Object.values(withToken.cards).filter((c) => c.kind === "deck-card").length;

  const next = applyCommand(withToken, { type: "DELETE_OBJECT", cardId: "token-1" });

  assert.ok(!("token-1" in next.cards));
  assert.ok(!next.zones.battlefield.includes("token-1"));
  assert.deepEqual(next.zones.library, libraryBefore);
  const deckCardCountAfter = Object.values(next.cards).filter((c) => c.kind === "deck-card").length;
  assert.equal(deckCardCountAfter, deckCardCountBefore);
});

test("SHUFFLE reorders only the requested zone", () => {
  const state = fixtureSixtyCardStart();
  const handBefore = [...state.zones.hand];
  const next = applyCommand(state, { type: "SHUFFLE", zone: "library", seed: 42 });
  assert.notDeepEqual(next.zones.library, state.zones.library);
  assert.equal(next.zones.library.length, state.zones.library.length);
  assert.deepEqual([...next.zones.library].sort(), [...state.zones.library].sort());
  assert.deepEqual(next.zones.hand, handBefore);
});

test("SET_LIFE changes only life; NEXT_TURN moves the turn and leaves life alone", () => {
  const state = fixtureCommanderStart();
  const afterLife = applyCommand(state, { type: "SET_LIFE", delta: -3 });
  assert.equal(afterLife.trackers.life, state.trackers.life - 3);
  assert.equal(afterLife.turn, state.turn);

  const afterTurn = applyCommand(state, { type: "NEXT_TURN" });
  assert.equal(afterTurn.turn, state.turn + 1);
  assert.equal(afterTurn.trackers.life, state.trackers.life);
});

test("RESTORE_SNAPSHOT replaces the whole state with the given snapshot", () => {
  const a = fixtureSixtyCardStart();
  const b: GameState = { ...fixtureCommanderStart(), turn: 9 };  const next = applyCommand(a, { type: "RESTORE_SNAPSHOT", snapshot: b });
  assert.deepEqual(next, b);
});

test("applyCommand never mutates the state object it was given", () => {
  const state = fixtureSixtyCardStart();
  const frozenLibrary = [...state.zones.library];
  applyCommand(state, { type: "DRAW", count: 5 });
  assert.deepEqual(state.zones.library, frozenLibrary);
});

test("identical starting state plus identical command sequence yields byte-identical states, log included", () => {
  // The determinism guarantee (plan section 4.3 / Phase 1's exit criterion)
  // covers the whole GameState, not just the pre-command fixture — a log
  // entry keyed by crypto.randomUUID() would fail this the moment any
  // command ran. Two independent fixtures rather than one shared object, so
  // this can't pass by aliasing.
  const commands: Parameters<typeof applyCommand>[1][] = [
    { type: "DRAW", count: 3 },
    { type: "SET_LIFE", delta: -3 },
    { type: "NEXT_TURN" },
  ];
  let a = fixtureSixtyCardStart();
  let b = fixtureSixtyCardStart();
  for (const command of commands) {
    a = applyCommand(a, command);
    b = applyCommand(b, command);
  }
  assert.deepEqual(a, b);
  assert.deepEqual(a.events, b.events);
  assert.ok(a.events.length >= 3, "each command left a structured event");
});
