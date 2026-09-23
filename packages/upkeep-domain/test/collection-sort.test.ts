/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { COLLECTION_SORTS, DEFAULT_COLLECTION_SORT, entryPrice, formatPrice, readCollectionSort, sortCollection, type CollectionSort, type SortableEntry } from "../src/collection-sort";

const e = (over: Partial<SortableEntry> & { id: string; card_name: string }): SortableEntry => ({
  card_set_code: "fdn", card_collector_number: "1", card_rarity: "common", finish: "nonfoil",
  card_cmc: 0, created_at: "2026-01-01T00:00:00Z", card_price_usd: null, card_price_usd_foil: null, card_price_usd_etched: null, ...over,
});
const ids = (list: SortableEntry[], sort: CollectionSort) => sortCollection(list, sort).map((x) => x.id);

test("price respects finish, with the plain price as the fallback", () => {
  const base = { card_price_usd: "1.00", card_price_usd_foil: "5.50", card_price_usd_etched: null };
  assert.equal(entryPrice({ finish: "nonfoil", ...base }), 1);
  assert.equal(entryPrice({ finish: "foil", ...base }), 5.5);
  assert.equal(entryPrice({ finish: "etched", ...base }), 1, "no etched price falls back to plain");
  assert.equal(entryPrice({ finish: "foil", card_price_usd: null, card_price_usd_foil: null }), null);
  assert.equal(entryPrice({ finish: "nonfoil", card_price_usd: "abc" }), null);
});

test("price sorts high to low using the copy's own finish, unpriced last", () => {
  const list = [
    e({ id: "cheap", card_name: "A", card_price_usd: "0.50", card_price_usd_foil: "20" }),
    e({ id: "foil", card_name: "B", finish: "foil", card_price_usd: "0.50", card_price_usd_foil: "20" }),
    e({ id: "none", card_name: "C" }),
    e({ id: "mid", card_name: "D", card_price_usd: 3 }),
  ];
  assert.deepEqual(ids(list, "price"), ["foil", "mid", "cheap", "none"]);
});

test("mana value ascending, missing last", () => {
  const list = [e({ id: "a", card_name: "A", card_cmc: 5 }), e({ id: "b", card_name: "B", card_cmc: null }), e({ id: "c", card_name: "C", card_cmc: "1" })];
  assert.deepEqual(ids(list, "mana"), ["c", "a", "b"]);
});

test("rarity puts the rarest first; unknown rarities sink", () => {
  const list = [
    e({ id: "c", card_name: "A", card_rarity: "common" }), e({ id: "m", card_name: "B", card_rarity: "mythic" }),
    e({ id: "x", card_name: "C", card_rarity: "???" }), e({ id: "r", card_name: "D", card_rarity: "rare" }),
  ];
  assert.deepEqual(ids(list, "rarity"), ["m", "r", "c", "x"]);
});

test("recently added is newest first", () => {
  const list = [e({ id: "old", card_name: "A", created_at: "2025-01-01T00:00:00Z" }), e({ id: "new", card_name: "B", created_at: "2026-06-01T00:00:00Z" }), e({ id: "none", card_name: "C", created_at: null })];
  assert.deepEqual(ids(list, "added"), ["new", "old", "none"]);
});

test("set groups by code, then collector number numerically", () => {
  const list = [
    e({ id: "k10", card_name: "A", card_set_code: "ktk", card_collector_number: "10" }),
    e({ id: "f2", card_name: "B", card_set_code: "fdn", card_collector_number: "2" }),
    e({ id: "k9", card_name: "C", card_set_code: "ktk", card_collector_number: "9" }),
    e({ id: "f10", card_name: "D", card_set_code: "fdn", card_collector_number: "10" }),
  ];
  assert.deepEqual(ids(list, "set"), ["f2", "f10", "k9", "k10"]);
});

test("ties fall back to name then id, so the order is stable", () => {
  const list = [e({ id: "2", card_name: "Same" }), e({ id: "1", card_name: "Same" }), e({ id: "3", card_name: "Abrade" })];
  assert.deepEqual(ids(list, "price"), ["3", "1", "2"]);
  assert.deepEqual(ids(list, "name"), ["3", "1", "2"]);
});

test("name sort ignores case and accents", () => {
  const list = [e({ id: "z", card_name: "Zap" }), e({ id: "e", card_name: "Éclair" }), e({ id: "a", card_name: "abrade" })];
  assert.deepEqual(ids(list, "name"), ["a", "e", "z"]);
});

test("does not mutate its input", () => {
  const list = [e({ id: "b", card_name: "B" }), e({ id: "a", card_name: "A" })];
  sortCollection(list, "name");
  assert.deepEqual(list.map((x) => x.id), ["b", "a"]);
});

test("readCollectionSort keeps only known values", () => {
  for (const s of COLLECTION_SORTS) assert.equal(readCollectionSort(s), s);
  assert.equal(readCollectionSort("bogus"), DEFAULT_COLLECTION_SORT);
  assert.equal(readCollectionSort(undefined), DEFAULT_COLLECTION_SORT);
});

test("formatPrice shows an em dash for unpriced, cents under $1000, whole dollars over", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(undefined), "—");
  assert.equal(formatPrice(4.5), "$4.50");
  assert.equal(formatPrice(999.99), "$999.99");
  assert.equal(formatPrice(1000), "$1,000");
  assert.equal(formatPrice(0), "$0.00");
});
