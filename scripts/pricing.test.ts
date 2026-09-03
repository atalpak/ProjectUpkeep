/**
 * Pricing tests.
 *
 * The rules that keep a collection total honest: the finish decides the price,
 * a missing price is not zero, and a total says how much of the collection it
 * could not account for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatPrice,
  priceFor,
  rowValue,
  summariseValue,
  type PriceableCard,
} from "../src/lib/collection/pricing";
import type { CardInstanceWithCard } from "../src/lib/types";

const priced = (
  usd: number | null,
  foil: number | null = null,
  etched: number | null = null,
): PriceableCard => ({
  price_usd: usd,
  price_usd_foil: foil,
  price_usd_etched: etched,
});

let n = 0;
function row(
  card: PriceableCard | null,
  finish: string,
  quantity: number,
  name = "Card",
): CardInstanceWithCard {
  n += 1;
  return {
    id: `inst-${n}`,
    quantity,
    finish,
    cards: card ? { ...card, name } : null,
  } as unknown as CardInstanceWithCard;
}

// ---------------------------------------------------------------------------
// Which price applies
// ---------------------------------------------------------------------------

test("a non-foil takes the non-foil price", () => {
  assert.equal(priceFor(priced(1.85, 9.5), "nonfoil"), 1.85);
});

test("a foil takes the foil price, not the cheap one", () => {
  assert.equal(priceFor(priced(1.85, 9.5), "foil"), 9.5);
});

test("an etched foil takes the etched price", () => {
  assert.equal(priceFor(priced(1.85, 9.5, 22), "etched"), 22);
});

test("a foil with no foil price is unpriced, never the non-foil price", () => {
  assert.equal(
    priceFor(priced(1.85, null), "foil"),
    null,
    "substituting the non-foil figure would understate a foil while looking correct",
  );
});

test("glossy falls back to the non-foil price, which is what it is", () => {
  assert.equal(priceFor(priced(1.85), "glossy"), 1.85);
});

test("no card and no price both give null", () => {
  assert.equal(priceFor(null, "nonfoil"), null);
  assert.equal(priceFor(priced(null), "nonfoil"), null);
});

// ---------------------------------------------------------------------------
// Row values
// ---------------------------------------------------------------------------

test("a row is worth its price times its quantity", () => {
  assert.equal(rowValue(row(priced(2.5), "nonfoil", 4)), 10);
});

test("an unpriced row is null, not zero", () => {
  assert.equal(rowValue(row(priced(null), "nonfoil", 4)), null);
});

test("a free card is genuinely zero, and stays counted", () => {
  // Bulk commons really do price at $0.00, which is different from unpriced.
  assert.equal(rowValue(row(priced(0), "nonfoil", 10)), 0);
});

// ---------------------------------------------------------------------------
// Collection totals
// ---------------------------------------------------------------------------

test("an empty collection is worth nothing and says so", () => {
  const s = summariseValue([]);
  assert.equal(s.total, 0);
  assert.equal(s.pricedRows, 0);
  assert.equal(s.unpricedRows, 0);
  assert.equal(s.mostValuable, null);
});

test("a total sums priced rows and counts what it could not price", () => {
  const s = summariseValue([
    row(priced(2), "nonfoil", 4), // 8
    row(priced(10, 30), "foil", 1), // 30
    row(priced(null), "nonfoil", 3), // unpriced
    row(null, "nonfoil", 2), // no card at all
  ]);

  assert.equal(s.total, 38);
  assert.equal(s.pricedRows, 2);
  assert.equal(s.unpricedRows, 2, "both the priceless and the card-less are reported");
  assert.equal(s.pricedCards, 5, "four plus one");
});

test("the most valuable row is by row value, not unit price", () => {
  const s = summariseValue([
    row(priced(50), "nonfoil", 1, "Expensive single"),
    row(priced(20), "nonfoil", 4, "Cheaper playset"),
  ]);
  assert.equal(s.mostValuable?.name, "Cheaper playset", "4 × 20 beats 1 × 50");
  assert.equal(s.mostValuable?.value, 80);
});

test("totals round once at the end, not per row", () => {
  // Three rows of 0.335 each: rounding per row would give 0.34 × 3 = 1.02.
  const s = summariseValue([
    row(priced(0.335), "nonfoil", 1),
    row(priced(0.335), "nonfoil", 1),
    row(priced(0.335), "nonfoil", 1),
  ]);
  assert.equal(s.total, 1.01);
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

test("a missing price shows as a dash, not as zero", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(undefined), "—");
});

test("prices format as currency", () => {
  assert.match(formatPrice(1.85), /1\.85/);
  assert.match(formatPrice(0), /0/);
});

test("large totals drop the cents", () => {
  const formatted = formatPrice(12345.67);
  assert.ok(!formatted.includes(".67"), `expected no cents in ${formatted}`);
});
