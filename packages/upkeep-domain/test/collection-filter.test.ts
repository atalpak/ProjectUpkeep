/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_COLLECTION_FILTER, collectionFacetCount, filterCollection, type CollectionFilter, type FilterableEntry } from "../src/collection-filter";

const card = (over: Partial<FilterableEntry> & { card_name: string }): FilterableEntry => ({
  card_type_line: "Creature", card_colors: ["R"], card_set_code: "fdn", card_rarity: "common", finish: "nonfoil", condition: "NM", location_id: null, ...over,
});
const entries = [
  card({ card_name: "Abrade", card_type_line: "Instant", finish: "foil", card_rarity: "uncommon" }),
  card({ card_name: "Abzan Battle Priest", card_colors: ["W"], card_set_code: "ktk", location_id: "binder-1" }),
  card({ card_name: "Éclair Royal", card_colors: ["W", "U"], location_id: "binder-1" }),
  card({ card_name: "Sol Ring", card_type_line: "Artifact", card_colors: [], card_rarity: "uncommon" }),
];
const f = (over: Partial<CollectionFilter>): CollectionFilter => ({ ...EMPTY_COLLECTION_FILTER, ...over });
const names = (over: Partial<CollectionFilter>) => filterCollection(entries, f(over)).map((e) => e.card_name);

test("no filter keeps everything, in order", () => {
  assert.deepEqual(names({}), ["Abrade", "Abzan Battle Priest", "Éclair Royal", "Sol Ring"]);
});

test("two letters narrow instantly, and every word must match", () => {
  assert.deepEqual(names({ name: "ab" }), ["Abrade", "Abzan Battle Priest"]);
  assert.deepEqual(names({ name: "abz bat" }), ["Abzan Battle Priest"]);
  assert.deepEqual(names({ name: "zzz" }), []);
});

test("search ignores case and accents", () => {
  assert.deepEqual(names({ name: "ECLAIR" }), ["Éclair Royal"]);
});

test("colours: all vs any, and colourless", () => {
  assert.deepEqual(names({ colors: ["W", "U"], colorMode: "all" }), ["Éclair Royal"]);
  assert.deepEqual(names({ colors: ["W", "U"], colorMode: "any" }), ["Abzan Battle Priest", "Éclair Royal"]);
  assert.deepEqual(names({ colorless: true }), ["Sol Ring"]);
});

test("location: unsorted vs a specific binder", () => {
  assert.deepEqual(names({ location: "unsorted" }), ["Abrade", "Sol Ring"]);
  assert.deepEqual(names({ location: "binder-1" }), ["Abzan Battle Priest", "Éclair Royal"]);
});

test("rarity, finish, type and set combine", () => {
  assert.deepEqual(names({ rarity: "uncommon", finish: "foil" }), ["Abrade"]);
  assert.deepEqual(names({ type: "artifact" }), ["Sol Ring"]);
  assert.deepEqual(names({ set: "KTK" }), ["Abzan Battle Priest"]);
});

test("facet count ignores the name text", () => {
  assert.equal(collectionFacetCount(f({ name: "x" })), 0);
  assert.equal(collectionFacetCount(f({ colors: ["R", "G"], rarity: "rare", location: "unsorted" })), 3);
});
