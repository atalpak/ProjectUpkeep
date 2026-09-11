/**
 * Want-list matching.
 *
 * Given "cards I want" and "cards people have open for trade", who can fill
 * what — across every printing, summed per person, best first.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capSuppliers,
  countMatchedWants,
  describeSupplier,
  matchTradablesByTerm,
  matchWants,
  type NamedTradableRow,
  type TradableRow,
  type WantRow,
  type WantSupplier,
} from "../src/lib/social/wants";

const want = (id: string, key: string, quantity = 1): WantRow => ({
  id,
  key,
  name: key,
  displayName: key,
  cardId: `p-${key}`,
  image: null,
  quantity,
  note: null,
});

const stock = (
  ownerId: string,
  key: string,
  quantity: number,
  locationName: string | null = "Trade Binder",
): TradableRow => ({ ownerId, key, quantity, locationName });

test("a want with no matching stock is absent from the result", () => {
  const m = matchWants([want("w1", "bolt")], [stock("alice", "path", 2)]);
  assert.equal(m.has("w1"), false);
  assert.equal(m.size, 0);
});

test("one owner's copies across printings sum into a single supplier line", () => {
  const m = matchWants(
    [want("w1", "bolt")],
    [
      stock("alice", "bolt", 2, "Binder A"),
      stock("alice", "bolt", 1, "Box 2"),
    ],
  );
  const suppliers = m.get("w1")!;
  assert.equal(suppliers.length, 1);
  assert.equal(suppliers[0].available, 3);
  assert.deepEqual(suppliers[0].locations.sort(), ["Binder A", "Box 2"]);
});

test("suppliers are ordered by how many they have", () => {
  const m = matchWants(
    [want("w1", "bolt")],
    [stock("alice", "bolt", 1), stock("bob", "bolt", 4), stock("cara", "bolt", 2)],
  );
  assert.deepEqual(
    m.get("w1")!.map((s) => s.ownerId),
    ["bob", "cara", "alice"],
  );
});

test("matching is by key, so any printing of the wanted card counts", () => {
  const m = matchWants([want("w1", "oracle-solring")], [stock("alice", "oracle-solring", 1)]);
  assert.equal(m.get("w1")!.length, 1);
});

test("zero-quantity stock is ignored", () => {
  const m = matchWants([want("w1", "bolt")], [stock("alice", "bolt", 0)]);
  assert.equal(m.size, 0);
});

test("countMatchedWants counts entries with at least one supplier", () => {
  const wants = [want("w1", "a"), want("w2", "b"), want("w3", "c")];
  const stockRows = [stock("alice", "a", 1), stock("bob", "c", 2)];
  assert.equal(countMatchedWants(wants, stockRows), 2);
});

test("a location-less stack still counts, just with no location listed", () => {
  const m = matchWants([want("w1", "bolt")], [stock("alice", "bolt", 1, null)]);
  assert.deepEqual(m.get("w1")![0].locations, []);
  assert.equal(m.get("w1")![0].available, 1);
});

// ---------------------------------------------------------------------------
// matchTradablesByTerm — the free-text half, for /find's "Among your friends"
// ---------------------------------------------------------------------------

const named = (
  ownerId: string,
  key: string,
  name: string,
  quantity: number,
  locationName: string | null = "Trade Binder",
  flavorName: string | null = null,
): NamedTradableRow => ({ ownerId, key, quantity, locationName, name, flavorName });

test("a term shorter than the minimum matches nothing", () => {
  assert.deepEqual(
    matchTradablesByTerm("s", [named("alice", "sol", "Sol Ring", 1)]),
    [],
  );
});

test("matches every word, anywhere, case-insensitively — same rule as your own collection", () => {
  const found = matchTradablesByTerm("bolt light", [named("alice", "bolt", "Lightning Bolt", 2)]);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Lightning Bolt");
});

test("a printed flavor name is matchable by either spelling", () => {
  const spark = named(
    "alice",
    "spark-double",
    "Spark Double",
    1,
    "Binder A",
    "Loki's Double",
  );
  assert.equal(matchTradablesByTerm("loki", [spark]).length, 1, "findable by the printed name");
  assert.equal(matchTradablesByTerm("spark", [spark]).length, 1, "and by the real name");
  assert.equal(
    matchTradablesByTerm("loki", [spark])[0].displayName,
    "Spark Double (Loki's Double)",
    "the real name leads, the printed name follows in parens",
  );
});

test("one card's suppliers are grouped and sorted, best first", () => {
  const found = matchTradablesByTerm("sol ring", [
    named("alice", "sol", "Sol Ring", 1, "Binder A"),
    named("bob", "sol", "Sol Ring", 3, "Box 2"),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(
    found[0].suppliers.map((s) => s.ownerId),
    ["bob", "alice"],
  );
});

test("a non-matching card is absent, not an empty entry", () => {
  const found = matchTradablesByTerm("bolt", [named("alice", "sol", "Sol Ring", 1)]);
  assert.deepEqual(found, []);
});

test("zero-quantity stock is ignored, same as matchWants", () => {
  const found = matchTradablesByTerm("sol", [named("alice", "sol", "Sol Ring", 0)]);
  assert.deepEqual(found, []);
});

test("results are limited and name-sorted", () => {
  const rows = ["Brute Force", "Brainstorm", "Brass Herald"].map((n, i) =>
    named(`friend${i}`, `key-${n}`, n, 1),
  );
  const found = matchTradablesByTerm("br", rows, 2);
  assert.deepEqual(found.map((c) => c.name), ["Brainstorm", "Brass Herald"]);
});

// ---------------------------------------------------------------------------
// capSuppliers — trimming a supplier list for a dropdown, not a page
// ---------------------------------------------------------------------------

const supplier = (ownerId: string, available = 1): WantSupplier => ({
  ownerId,
  available,
  locations: [],
});

test("fewer suppliers than the cap are all shown, with nothing left over", () => {
  const { shown, more } = capSuppliers([supplier("a"), supplier("b")], 3);
  assert.equal(shown.length, 2);
  assert.equal(more, 0);
});

test("more suppliers than the cap are trimmed, and the rest are counted", () => {
  const suppliers = [supplier("a"), supplier("b"), supplier("c"), supplier("d")];
  const { shown, more } = capSuppliers(suppliers, 2);
  assert.deepEqual(shown.map((s) => s.ownerId), ["a", "b"]);
  assert.equal(more, 2);
});

// ---------------------------------------------------------------------------
// describeSupplier — the "2 in Trade Binder B" half of a supplier line,
// shared by /wants, a deck's wish list, /decks/check and a friend's profile
// ---------------------------------------------------------------------------

test("no location on record still names the count", () => {
  assert.equal(describeSupplier(3, []), "3");
});

test("one location is named alongside the count", () => {
  assert.equal(describeSupplier(2, ["Trade Binder B"]), "2 in Trade Binder B");
});

test("more than one location is listed in full, not folded to a count", () => {
  assert.equal(
    describeSupplier(3, ["Trade Binder B", "Box 2"]),
    "3 in Trade Binder B, Box 2",
  );
});
