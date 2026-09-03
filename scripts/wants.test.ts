/**
 * Want-list matching.
 *
 * Given "cards I want" and "cards people have open for trade", who can fill
 * what — across every printing, summed per person, best first.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countMatchedWants,
  matchWants,
  type TradableRow,
  type WantRow,
} from "../src/lib/social/wants";

const want = (id: string, key: string, quantity = 1): WantRow => ({
  id,
  key,
  name: key,
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
