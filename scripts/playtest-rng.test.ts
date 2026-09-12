/**
 * The seeded PRNG and its shuffle.
 *
 * What matters for the playtest lab is reproducibility (the UI re-shows a
 * specific hand by seed) and correctness (a shuffle that drops or duplicates
 * a card would silently shrink or inflate the deck it's dealing from).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { mulberry32, shuffle } from "../src/lib/playtest/rng";

test("the same seed produces the same sequence of floats", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test("different seeds produce different sequences", () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test("every draw lands in [0, 1)", () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `${v} out of range`);
  }
});

test("shuffling with the same seed gives the same order", () => {
  const deck = Array.from({ length: 60 }, (_, i) => i);
  const a = shuffle([...deck], mulberry32(7));
  const b = shuffle([...deck], mulberry32(7));
  assert.deepEqual(a, b);
});

test("shuffling with different seeds (very likely) gives a different order", () => {
  const deck = Array.from({ length: 60 }, (_, i) => i);
  const a = shuffle([...deck], mulberry32(7));
  const b = shuffle([...deck], mulberry32(8));
  assert.notDeepEqual(a, b);
});

test("a shuffle is a permutation: same elements, none lost or duplicated", () => {
  const deck = Array.from({ length: 99 }, (_, i) => `card-${i}`);
  const shuffled = shuffle([...deck], mulberry32(2026));
  assert.equal(shuffled.length, deck.length);
  assert.deepEqual([...shuffled].sort(), [...deck].sort());
});

test("shuffle mutates and returns the same array reference", () => {
  const deck = [1, 2, 3, 4, 5];
  const result = shuffle(deck, mulberry32(1));
  assert.equal(result, deck);
});
