/**
 * shuffleZone (board/shuffle.ts): a thin wrapper over the shared
 * src/lib/playtest/rng.ts primitives. The interesting property is exactly
 * the one this phase's exit criterion names — same seed, same result.
 *
 * Run with: npx tsx --test scripts/playtest-board-shuffle.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { shuffleZone } from "../src/lib/playtest/board/shuffle";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";

test("the same seed produces the same order every time", () => {
  const state = fixtureSixtyCardStart();
  const a = shuffleZone(state, "library", 999);
  const b = shuffleZone(state, "library", 999);
  assert.deepEqual(a.zones.library, b.zones.library);
});

test("different seeds produce different orders (overwhelmingly likely for 60 cards)", () => {
  const state = fixtureSixtyCardStart();
  const a = shuffleZone(state, "library", 1);
  const b = shuffleZone(state, "library", 2);
  assert.notDeepEqual(a.zones.library, b.zones.library);
});

test("shuffling reorders, never adds or removes cards", () => {
  const state = fixtureSixtyCardStart();
  const shuffled = shuffleZone(state, "library", 5);
  assert.deepEqual([...shuffled.zones.library].sort(), [...state.zones.library].sort());
});
