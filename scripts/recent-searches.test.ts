/**
 * Recent header searches — the pure list rule (storage itself needs a
 * browser, so it stays out of this suite; see `recent-searches.ts`'s header).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { pushRecentSearch } from "../src/lib/search/recent-searches";

test("a fresh term lands at the front", () => {
  assert.deepEqual(pushRecentSearch([], "sol ring"), ["sol ring"]);
  assert.deepEqual(pushRecentSearch(["sol ring"], "lightning bolt"), [
    "lightning bolt",
    "sol ring",
  ]);
});

test("blank input changes nothing", () => {
  assert.deepEqual(pushRecentSearch(["sol ring"], "   "), ["sol ring"]);
});

test("re-searching an existing term moves it to the front instead of duplicating", () => {
  assert.deepEqual(pushRecentSearch(["lightning bolt", "sol ring"], "sol ring"), [
    "sol ring",
    "lightning bolt",
  ]);
});

test("deduplication is case-insensitive", () => {
  assert.deepEqual(pushRecentSearch(["Sol Ring"], "sol ring"), ["sol ring"]);
});

test("the list is capped at max, oldest dropped first", () => {
  const result = pushRecentSearch(["a", "b", "c"], "d", 3);
  assert.deepEqual(result, ["d", "a", "b"]);
});
