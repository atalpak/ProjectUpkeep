/**
 * "Where is my card?" grouping.
 *
 * Given a flat collection and a search term, produce each matching card with
 * every place its copies sit — ordered, counted, deck-aware.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { locateCards, nameMatches, type LocatableRow } from "../src/lib/collection/locate";

type Loc = NonNullable<LocatableRow["locations"]>;

const row = (
  name: string,
  quantity: number,
  location: Loc | null,
  oracle_id: string | null = `oracle-${name}`,
): LocatableRow => ({
  quantity,
  cards: { oracle_id, name, image_uri_small: null, card_id: `printing-${name}` },
  locations: location,
});

const binder: Loc = { id: "b1", name: "Commander Binder", type: "binder" };
const box: Loc = { id: "x1", name: "Box 3", type: "box" };
const deck: Loc = { id: "d1", name: "Atarka Aggro", type: "deck" };

test("nameMatches wants every word, anywhere, case-insensitively", () => {
  assert.equal(nameMatches("Lightning Bolt", "bolt"), true);
  assert.equal(nameMatches("Lightning Bolt", "bolt light"), true);
  assert.equal(nameMatches("Lightning Bolt", "LIGHT"), true);
  assert.equal(nameMatches("Lightning Bolt", "counterspell"), false);
  assert.equal(nameMatches("Sol Ring", ""), false);
});

test("a term shorter than the minimum returns nothing", () => {
  assert.deepEqual(locateCards([row("Sol Ring", 1, binder)], "s"), []);
});

test("copies of one card across places are grouped and counted", () => {
  const found = locateCards(
    [
      row("Sol Ring", 2, binder),
      row("Sol Ring", 1, deck),
      row("Sol Ring", 1, null),
      row("Arcane Signet", 1, box),
    ],
    "sol",
  );

  assert.equal(found.length, 1);
  const sol = found[0];
  assert.equal(sol.name, "Sol Ring");
  assert.equal(sol.total, 4);
  assert.equal(sol.available, 3, "the copy in a deck is not available");
  assert.equal(sol.places.length, 3);
});

test("places are ordered by count, with unsorted always last", () => {
  const [sol] = locateCards(
    [
      row("Sol Ring", 1, binder),
      row("Sol Ring", 3, null), // unsorted, biggest pile
      row("Sol Ring", 2, box),
    ],
    "sol",
  );

  assert.deepEqual(
    sol.places.map((p) => [p.name, p.quantity]),
    [
      ["Box 3", 2],
      ["Commander Binder", 1],
      ["Unsorted", 3],
    ],
    "unsorted is pinned last even though it holds the most",
  );
});

test("two stacks of the same card in the same location collapse to one place", () => {
  const [sol] = locateCards(
    [row("Sol Ring", 1, binder), row("Sol Ring", 2, binder)],
    "sol",
  );
  assert.equal(sol.places.length, 1);
  assert.equal(sol.places[0].quantity, 3);
});

test("every printing of a card groups under one oracle id", () => {
  const found = locateCards(
    [
      { ...row("Sol Ring", 1, binder), cards: { oracle_id: "sol", name: "Sol Ring", image_uri_small: null } },
      { ...row("Sol Ring", 1, box), cards: { oracle_id: "sol", name: "Sol Ring", image_uri_small: "img.png" } },
    ],
    "sol",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].total, 2);
  assert.equal(found[0].image, "img.png", "an image from any printing fills a gap");
});

test("results are limited and name-sorted", () => {
  const rows = ["Brute Force", "Brainstorm", "Brass Herald", "Bringer of Dawn"].map((n) =>
    row(n, 1, box),
  );
  const found = locateCards(rows, "br", 2); // matches all four; take the first 2 by name
  assert.deepEqual(
    found.map((c) => c.name),
    ["Brainstorm", "Brass Herald"],
  );
});

test("a row with no card is skipped, not thrown on", () => {
  const found = locateCards(
    [{ quantity: 1, cards: null, locations: binder }, row("Sol Ring", 1, box)],
    "sol",
  );
  assert.equal(found.length, 1);
});
