/**
 * Exact hypergeometric probabilities.
 *
 * The point of this module is that these numbers are not approximations, so
 * the tests check them against values computed independently — with exact
 * integer binomial coefficients (BigInt), not by calling back into
 * `logChoose` — rather than against numbers merely copied from the module
 * under test.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { atLeast, hypergeometric, landCountDistribution } from "../src/lib/playtest/odds";

const EPS = 1e-9;

/** Exact nCk via BigInt, independent of anything in odds.ts. */
function exactChoose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let num = 1n;
  let den = 1n;
  for (let i = 0; i < k; i++) {
    num *= BigInt(n - i);
    den *= BigInt(i + 1);
  }
  return num / den;
}

/** Exact hypergeometric probability as an exact rational (numerator over
 *  denominator), independent of odds.ts's log-based implementation. */
function exactHypergeometric(k: number, successes: number, population: number, draws: number): number {
  const numerator = exactChoose(successes, k) * exactChoose(population - successes, draws - k);
  const denominator = exactChoose(population, draws);
  return Number(numerator) / Number(denominator);
}

test("hypergeometric matches an independent exact (BigInt) computation", () => {
  // 24 lands in a 60-card deck, opening 7, at least 2 of them.
  const expected =
    exactHypergeometric(2, 24, 60, 7) +
    exactHypergeometric(3, 24, 60, 7) +
    exactHypergeometric(4, 24, 60, 7) +
    exactHypergeometric(5, 24, 60, 7) +
    exactHypergeometric(6, 24, 60, 7) +
    exactHypergeometric(7, 24, 60, 7);

  const actual = atLeast(2, 24, 60, 7);
  assert.ok(Math.abs(actual - expected) < EPS, `${actual} vs exact ${expected}`);

  // The number itself, pinned down: ~85.7%, not merely "close to something".
  assert.ok(Math.abs(actual - 0.8573441200898213) < 1e-9);
});

test("a single hypergeometric value against a hand-checked textbook case", () => {
  // Exactly 2 lands in an opening 7 from a 40-card deck with 17 lands — a
  // commonly quoted limited-deck statistic, independently exact-computed.
  const expected = exactHypergeometric(2, 17, 40, 7);
  assert.ok(Math.abs(hypergeometric(2, 17, 40, 7) - expected) < EPS);
});

test("drawing more successes than exist in the deck is impossible", () => {
  assert.equal(hypergeometric(5, 3, 40, 7), 0);
});

test("drawing more cards than the deck holds is impossible", () => {
  assert.equal(hypergeometric(1, 10, 5, 6), 0);
});

test("atLeast(0, ...) is certainty", () => {
  assert.ok(Math.abs(atLeast(0, 24, 60, 7) - 1) < EPS);
});

test("landCountDistribution sums to 1", () => {
  const dist = landCountDistribution(24, 60, 7);
  const total = dist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < EPS, `sum was ${total}`);
  assert.equal(dist.length, 8);
});

test("landCountDistribution's own atLeast-2 tail matches atLeast()", () => {
  const dist = landCountDistribution(24, 60, 7);
  const tail = dist.slice(2).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(tail - atLeast(2, 24, 60, 7)) < EPS);
});

test("a deck that is all lands always opens with a full hand of them", () => {
  const dist = landCountDistribution(60, 60, 7);
  assert.ok(Math.abs(dist[7] - 1) < EPS);
  assert.ok(dist.slice(0, 7).every((p) => Math.abs(p) < EPS));
});

test("a deck with no lands never opens with any", () => {
  const dist = landCountDistribution(0, 60, 7);
  assert.ok(Math.abs(dist[0] - 1) < EPS);
});
