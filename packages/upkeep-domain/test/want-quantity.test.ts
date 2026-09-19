/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_WANT_QUANTITY, MIN_WANT_QUANTITY, clampWantQuantity } from "../src/want-quantity";

test("stays inside the table's CHECK (1..10000)", () => {
  assert.equal(clampWantQuantity(0), MIN_WANT_QUANTITY);
  assert.equal(clampWantQuantity(-5), MIN_WANT_QUANTITY);
  assert.equal(clampWantQuantity(10001), MAX_WANT_QUANTITY);
  assert.equal(clampWantQuantity(3), 3);
});

test("whole numbers only; unreadable input becomes the minimum", () => {
  assert.equal(clampWantQuantity(2.9), 2);
  assert.equal(clampWantQuantity(Number.NaN), MIN_WANT_QUANTITY);
  assert.equal(clampWantQuantity(Infinity), MIN_WANT_QUANTITY);
});
