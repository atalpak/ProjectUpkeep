/**
 * Snapshot serialization/validation (board/serialize.ts, invariants.ts,
 * migrate.ts): malformed, unknown, oversize or inconsistent data must be
 * rejected safely, never coerced into a `GameState` the rest of the board
 * would then act on. This is the gate in front of localStorage, the database
 * and the public projection, so it is tested for what it must REFUSE.
 *
 * Run with: npx tsx --test scripts/playtest-board-serialize.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SnapshotValidationError,
  deserializeSnapshot,
  fitForSave,
  serializeSnapshot,
  tryValidateSnapshot,
  validateSnapshot,
} from "../src/lib/playtest/board/serialize";
import { applyCommand } from "../src/lib/playtest/board/reduce";
import { fixtureCommanderStart, fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import type { GameState } from "../src/lib/playtest/board/types";

function raw(state: GameState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

test("a real GameState round-trips through serialize/deserialize unchanged", () => {
  let state = fixtureCommanderStart();
  state = applyCommand(state, { type: "MOVE_MANY", ids: state.zones.library.slice(0, 3), to: "battlefield", at: "bottom" });
  state = applyCommand(state, { type: "ADD_COUNTER", cardId: state.zones.battlefield[0], name: "charge", delta: 2 });
  state = applyCommand(state, { type: "SET_GROUP", ids: state.zones.battlefield.slice(1), groupId: "g1", group: { label: "Two" } });
  state = applyCommand(state, { type: "SET_TRACKER", path: "commanderDamage.Atraxa", value: 7 });
  const restored = deserializeSnapshot(serializeSnapshot(state));
  assert.deepEqual(restored, state);
});

test("rejects invalid JSON and non-objects", () => {
  assert.throws(() => deserializeSnapshot("{not json"), SnapshotValidationError);
  assert.throws(() => validateSnapshot("just a string"), SnapshotValidationError);
  assert.throws(() => validateSnapshot(42), SnapshotValidationError);
  assert.throws(() => validateSnapshot(null), SnapshotValidationError);
});

test("rejects an unknown or missing schemaVersion", () => {
  const state = fixtureSixtyCardStart();
  assert.throws(() => validateSnapshot({ ...state, schemaVersion: 3 }), SnapshotValidationError);
  assert.throws(() => validateSnapshot({ ...state, schemaVersion: "2" }), SnapshotValidationError);
  const withoutVersion = raw(state);
  delete withoutVersion.schemaVersion;
  assert.throws(() => validateSnapshot(withoutVersion), SnapshotValidationError);
});

test("rejects a zone referencing a card id that doesn't exist in the card table", () => {
  const state = raw(fixtureSixtyCardStart());
  (state.zones as Record<string, string[]>).hand = ["nonexistent-card"];
  assert.throws(() => validateSnapshot(state), /missing card/);
});

test("rejects a card that appears in two zones, and a card that is in no zone", () => {
  const twice = raw(fixtureSixtyCardStart());
  const zones = twice.zones as Record<string, string[]>;
  zones.hand = [zones.library[0]];
  assert.throws(() => validateSnapshot(twice), /appears in/);

  const nowhere = raw(fixtureSixtyCardStart());
  (nowhere.zones as Record<string, string[]>).library.shift();
  assert.throws(() => validateSnapshot(nowhere), /in no zone/);

  const duplicate = raw(fixtureSixtyCardStart());
  const lib = (duplicate.zones as Record<string, string[]>).library;
  lib.push(lib[0]);
  assert.throws(() => validateSnapshot(duplicate), SnapshotValidationError);
});

test("rejects a card missing required fields", () => {
  const state = raw(fixtureSixtyCardStart());
  const cardId = (state.zones as Record<string, string[]>).library[0];
  delete (state.cards as Record<string, Record<string, unknown>>)[cardId].tapped;
  assert.throws(() => validateSnapshot(state), SnapshotValidationError);
});

test("unknown fields are dropped, not copied through", () => {
  const state = raw(fixtureSixtyCardStart());
  const cardId = (state.zones as Record<string, string[]>).library[0];
  (state.cards as Record<string, Record<string, unknown>>)[cardId].evil = "<script>";
  state.extra = { secret: 1 };
  (state.trackers as Record<string, unknown>).hidden = "x";
  const clean = validateSnapshot(state) as unknown as Record<string, unknown>;
  assert.equal("extra" in clean, false);
  assert.equal("evil" in (clean.cards as Record<string, Record<string, unknown>>)[cardId], false);
  assert.equal("hidden" in (clean.trackers as Record<string, unknown>), false);
});

test("caps and finiteness: oversize text, a non-finite number, a huge counter and an off-board position are refused", () => {
  const longName = raw(fixtureSixtyCardStart());
  const id = (longName.zones as Record<string, string[]>).library[0];
  const cards = (s: Record<string, unknown>) => s.cards as Record<string, Record<string, unknown>>;
  cards(longName)[id].name = "x".repeat(201);
  assert.throws(() => validateSnapshot(longName), SnapshotValidationError);

  const bigNote = raw(fixtureSixtyCardStart());
  cards(bigNote)[id].note = "n".repeat(1001);
  assert.throws(() => validateSnapshot(bigNote), SnapshotValidationError);

  const nan = raw(fixtureSixtyCardStart());
  (nan.trackers as Record<string, unknown>).life = "NaN";
  assert.throws(() => validateSnapshot(nan), SnapshotValidationError);

  const hugeCounter = raw(fixtureSixtyCardStart());
  cards(hugeCounter)[id].counters = { charge: 10 ** 9 };
  assert.throws(() => validateSnapshot(hugeCounter), SnapshotValidationError);

  const offBoard = raw(fixtureSixtyCardStart());
  cards(offBoard)[id].pos = { x: 4, y: 0 };
  assert.throws(() => validateSnapshot(offBoard), SnapshotValidationError);

  const badLife = raw(fixtureSixtyCardStart());
  (badLife.trackers as Record<string, unknown>).life = 10 ** 9;
  assert.throws(() => validateSnapshot(badLife), SnapshotValidationError);

  const imageUrl = raw(fixtureSixtyCardStart());
  cards(imageUrl)[id].imageSmall = "https://x/" + "a".repeat(600);
  assert.throws(() => validateSnapshot(imageUrl), SnapshotValidationError);
});

test("a grouped card must name an existing group, and an ungrouped battlefield card needs a position", () => {
  let state = fixtureSixtyCardStart();
  state = applyCommand(state, { type: "MOVE_MANY", ids: state.zones.library.slice(0, 2), to: "battlefield", at: "bottom" });
  state = applyCommand(state, { type: "SET_GROUP", ids: state.zones.battlefield, groupId: "g", group: { label: "G" } });

  const noGroup = raw(state);
  delete (noGroup.groups as Record<string, unknown>).g;
  assert.throws(() => validateSnapshot(noGroup), /missing group/);

  const noPos = raw(applyCommand(fixtureSixtyCardStart(), { type: "MOVE_MANY", ids: [fixtureSixtyCardStart().zones.library[0]], to: "battlefield", at: "bottom" }));
  const battlefieldId = (noPos.zones as Record<string, string[]>).battlefield[0];
  (noPos.cards as Record<string, Record<string, unknown>>)[battlefieldId].pos = null;
  assert.throws(() => validateSnapshot(noPos), /no position/);
});

test("the event log is bounded and its sequence numbers must increase", () => {
  const base = raw(applyCommand(fixtureSixtyCardStart(), { type: "SET_LIFE", delta: -1 }));
  const events = base.events as Array<Record<string, unknown>>;
  assert.throws(() => validateSnapshot({ ...base, events: [events[0], events[0]] }), /not increasing/);
  assert.throws(() => validateSnapshot({ ...base, events: Array.from({ length: 1001 }, (_, i) => ({ ...events[0], seq: i })), nextEventSeq: 2000 }), SnapshotValidationError);
  assert.throws(() => validateSnapshot({ ...base, nextEventSeq: 0 }), /nextEventSeq/);
});

test("tryValidateSnapshot returns null instead of throwing for malformed input", () => {
  assert.equal(tryValidateSnapshot({ schemaVersion: 999 }), null);
  assert.equal(tryValidateSnapshot("garbage"), null);
  assert.deepEqual(tryValidateSnapshot(fixtureSixtyCardStart()), fixtureSixtyCardStart());
});

test("fitForSave drops the oldest events to fit, records the cut, and never touches the board", () => {
  let state = fixtureSixtyCardStart();
  for (let i = 0; i < 300; i++) state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: 20 - (i % 2) });
  const before = JSON.stringify(state).length;
  const fitted = fitForSave(state, Math.floor(before / 2));
  assert.ok(fitted.events.length < state.events.length);
  assert.equal(fitted.eventsTruncatedBefore, fitted.events[0]?.seq ?? fitted.nextEventSeq);
  assert.deepEqual(fitted.zones, state.zones);
  assert.deepEqual(fitted.cards, state.cards);
  assert.doesNotThrow(() => validateSnapshot(fitted));
  assert.equal(fitForSave(state), state, "already small enough: returned unchanged");
});

test("the key __proto__ is refused wherever a name becomes an object key (card ids, counters, groups, labels)", () => {
  // JSON.parse (unlike an object literal) creates a real own "__proto__" key.
  const cardId = fixtureSixtyCardStart().zones.library[0];

  const counter = JSON.parse(JSON.stringify(fixtureSixtyCardStart())) as Record<string, unknown>;
  ((counter.cards as Record<string, Record<string, unknown>>)[cardId]).counters = JSON.parse('{"__proto__": 3}');
  assert.throws(() => validateSnapshot(counter), /reserved/);

  const damage = JSON.parse(JSON.stringify(fixtureSixtyCardStart())) as Record<string, unknown>;
  (damage.trackers as Record<string, unknown>).commanderDamage = JSON.parse('{"__proto__": 3}');
  assert.throws(() => validateSnapshot(damage), /reserved/);

  const groups = JSON.parse(JSON.stringify(fixtureSixtyCardStart())) as Record<string, unknown>;
  groups.groups = JSON.parse('{"__proto__": {"label":"x","arrangement":"row","anchor":{"x":0,"y":0}}}');
  assert.throws(() => validateSnapshot(groups), /reserved/);

  const ids = JSON.parse(JSON.stringify(fixtureSixtyCardStart())) as Record<string, unknown>;
  ids.cards = JSON.parse('{"__proto__": {}}');
  assert.throws(() => validateSnapshot(ids), SnapshotValidationError);
});
