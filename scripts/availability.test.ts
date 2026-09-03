/**
 * Availability tests.
 *
 * The counting rule is the product's whole answer to "can I put this in a
 * deck", so it is worth being explicit about the cases: printings group, decks
 * take copies out of circulation, and unsorted is available rather than lost.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availabilityFor,
  cardKey,
  computeAvailability,
  planSplit,
  takeableFrom,
  type CountableRow,
} from "../src/lib/collection/availability";
import type { LocationType } from "../src/lib/types";

const BOLT_ORACLE = "oracle-bolt";

function row(
  quantity: number,
  locationType: LocationType | null,
  oracle: string | null = BOLT_ORACLE,
  name = "Lightning Bolt",
): CountableRow {
  return {
    quantity,
    cards: { oracle_id: oracle, name },
    locations: locationType ? { type: locationType } : null,
  };
}

const bolt = (map: ReturnType<typeof computeAvailability>) =>
  availabilityFor(map, { oracle_id: BOLT_ORACLE, name: "Lightning Bolt" });

test("nothing owned is nothing available", () => {
  const map = computeAvailability([]);
  assert.deepEqual(bolt(map), { total: 0, inDecks: 0, available: 0 });
});

test("a card in a binder is available", () => {
  const map = computeAvailability([row(4, "binder")]);
  assert.deepEqual(bolt(map), { total: 4, inDecks: 0, available: 4 });
});

test("unsorted counts as available, not as missing", () => {
  const map = computeAvailability([row(2, null)]);
  assert.deepEqual(bolt(map), { total: 2, inDecks: 0, available: 2 });
});

test("boxes and other containers are available too", () => {
  const map = computeAvailability([row(1, "box"), row(1, "other")]);
  assert.deepEqual(bolt(map), { total: 2, inDecks: 0, available: 2 });
});

test("a deck takes copies out of circulation", () => {
  const map = computeAvailability([row(3, "deck")]);
  assert.deepEqual(bolt(map), { total: 3, inDecks: 3, available: 0 });
});

test("the headline case: 4 owned, 3 sleeved, 1 free", () => {
  const map = computeAvailability([row(1, "binder"), row(2, "deck"), row(1, "deck")]);
  assert.deepEqual(bolt(map), { total: 4, inDecks: 3, available: 1 });
});

test("printings of the same card are counted together", () => {
  // Same oracle id, four different sets — a deck does not care which.
  const map = computeAvailability([
    row(1, "binder"),
    row(1, "box"),
    row(1, null),
    row(1, "deck"),
  ]);
  assert.deepEqual(bolt(map), { total: 4, inDecks: 1, available: 3 });
});

test("different cards are counted separately", () => {
  const map = computeAvailability([
    row(4, "binder"),
    row(2, "deck", "oracle-counterspell", "Counterspell"),
  ]);
  assert.deepEqual(bolt(map), { total: 4, inDecks: 0, available: 4 });
  assert.deepEqual(availabilityFor(map, { oracle_id: "oracle-counterspell", name: "Counterspell" }), {
    total: 2,
    inDecks: 2,
    available: 0,
  });
});

test("a card with no oracle id falls back to its name", () => {
  const map = computeAvailability([row(2, "binder", null, "Weird Promo")]);
  assert.deepEqual(availabilityFor(map, { oracle_id: null, name: "Weird Promo" }), {
    total: 2,
    inDecks: 0,
    available: 2,
  });
});

test("the name fallback is case-insensitive", () => {
  assert.equal(cardKey({ oracle_id: null, name: "Sol Ring" }), cardKey({ oracle_id: null, name: "SOL RING" }));
});

test("a row with no printing is skipped rather than throwing", () => {
  const map = computeAvailability([{ quantity: 3, cards: null, locations: null }]);
  assert.equal(map.size, 0);
});

// ---------------------------------------------------------------------------
// What a single stack offers
// ---------------------------------------------------------------------------

test("a stack in a deck offers nothing to take", () => {
  assert.equal(takeableFrom({ quantity: 4, locations: { id: "l", name: "Deck", type: "deck" } }), 0);
});

test("a stack anywhere else offers all of itself", () => {
  assert.equal(takeableFrom({ quantity: 4, locations: null }), 4);
  assert.equal(
    takeableFrom({ quantity: 4, locations: { id: "l", name: "Binder", type: "binder" } }),
    4,
  );
});

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

test("taking the whole stack moves the row itself", () => {
  assert.deepEqual(planSplit(4, 4), { action: "moveWhole", quantity: 4 });
});

test("taking some of a stack splits it", () => {
  assert.deepEqual(planSplit(4, 1), { action: "split", take: 1, leave: 3 });
});

test("you cannot take more than you have", () => {
  const result = planSplit(2, 3);
  assert.ok("error" in result);
  assert.match(result.error, /Only 2 copies/);
});

test("nothing available says so plainly", () => {
  const result = planSplit(0, 1);
  assert.ok("error" in result);
  assert.match(result.error, /No copies/);
});

test("a quantity has to be a whole number of at least one", () => {
  assert.ok("error" in planSplit(4, 0));
  assert.ok("error" in planSplit(4, -1));
  assert.ok("error" in planSplit(4, 1.5));
});
