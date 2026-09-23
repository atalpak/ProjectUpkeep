/**
 * Snapshot serialization/validation (board/serialize.ts): malformed, unknown,
 * or cross-version data must be rejected safely, never coerced into a
 * `GameState` the rest of the board would then act on.
 *
 * Run with: npx tsx --test scripts/playtest-board-serialize.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SnapshotValidationError,
  deserializeSnapshot,
  serializeSnapshot,
  tryValidateSnapshot,
  validateSnapshot,
} from "../src/lib/playtest/board/serialize";
import { fixtureCommanderStart, fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";

test("a real GameState round-trips through serialize/deserialize unchanged", () => {
  const state = fixtureCommanderStart();
  const raw = serializeSnapshot(state);
  const restored = deserializeSnapshot(raw);
  assert.deepEqual(restored, state);
});

test("rejects invalid JSON", () => {
  assert.throws(() => deserializeSnapshot("{not json"), SnapshotValidationError);
});

test("rejects a non-object snapshot", () => {
  assert.throws(() => validateSnapshot("just a string"), SnapshotValidationError);
  assert.throws(() => validateSnapshot(42), SnapshotValidationError);
  assert.throws(() => validateSnapshot(null), SnapshotValidationError);
});

test("rejects an unknown/cross-version schemaVersion", () => {
  const state = fixtureSixtyCardStart();
  assert.throws(() => validateSnapshot({ ...state, schemaVersion: 2 }), SnapshotValidationError);
  assert.throws(() => validateSnapshot({ ...state, schemaVersion: "1" }), SnapshotValidationError);
  const withoutVersion: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
  delete withoutVersion.schemaVersion;
  assert.throws(() => validateSnapshot(withoutVersion), SnapshotValidationError);
});

test("rejects a zone referencing a card id that doesn't exist in the card table", () => {
  const state = fixtureSixtyCardStart();
  const broken = { ...state, zones: { ...state.zones, hand: ["nonexistent-card"] } };
  assert.throws(() => validateSnapshot(broken), SnapshotValidationError);
});

test("rejects a card missing required fields", () => {
  const state = fixtureSixtyCardStart();
  const cardId = state.zones.library[0];
  const brokenCard: Record<string, unknown> = { ...(state.cards[cardId] as unknown as Record<string, unknown>) };
  delete brokenCard.tapped;
  const broken = { ...state, cards: { ...state.cards, [cardId]: brokenCard } };
  assert.throws(() => validateSnapshot(broken), SnapshotValidationError);
});

test("tryValidateSnapshot returns null instead of throwing for malformed input", () => {
  assert.equal(tryValidateSnapshot({ schemaVersion: 999 }), null);
  assert.equal(tryValidateSnapshot("garbage"), null);
  assert.deepEqual(tryValidateSnapshot(fixtureSixtyCardStart()), fixtureSixtyCardStart());
});
