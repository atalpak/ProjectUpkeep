/**
 * Table sorting and the stored column choice.
 *
 * Sorting has one rule worth pinning down: a missing value is not a small
 * value. A card with no power should sit at the bottom whichever way the
 * column is sorted, rather than leading the descending view.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_COLUMNS,
  parseStoredColumns,
  sortRows,
  type ColumnId,
} from "../src/components/collection/columns";
import type { Card, CardInstanceWithCard } from "../src/lib/types";

function row(
  id: string,
  card: Partial<Card>,
  instance: Partial<CardInstanceWithCard> = {},
): CardInstanceWithCard {
  return {
    id,
    owner_user_id: "user-1",
    card_id: `card-${id}`,
    location_id: null,
    condition: "NM",
    finish: "nonfoil",
    language: "en",
    quantity: 1,
    notes: null,
    acquired_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    locations: null,
    ...instance,
    cards: {
      scryfall_id: `card-${id}`,
      oracle_id: null,
      name: "Card",
      set_code: "tst",
      set_name: "Test Set",
      collector_number: "1",
      rarity: "common",
      type_line: "Instant",
      released_at: "2020-01-01",
      image_uri: null,
      image_uri_small: null,
      scryfall_uri: null,
      available_finishes: ["nonfoil"],
      lang: "en",
      digital: false,
      last_synced_at: "2026-01-01T00:00:00Z",
      mana_cost: null,
      cmc: null,
      colors: null,
      color_identity: null,
      oracle_text: null,
      flavor_text: null,
      keywords: null,
      power: null,
      toughness: null,
      loyalty: null,
      artist: null,
      layout: "normal",
      card_faces: null,
      set_type: "expansion",
      price_usd: null,
      price_usd_foil: null,
      price_usd_etched: null,
      price_eur: null,
      price_eur_foil: null,
      tcgplayer_id: null,
      purchase_uri: null,
      prices_updated_at: null,
      ...card,
    },
  } as CardInstanceWithCard;
}

const names = (rows: CardInstanceWithCard[]) => rows.map((r) => r.cards?.name);

test("no sort leaves the order alone", () => {
  const rows = [row("1", { name: "Zebra" }), row("2", { name: "Aardvark" })];
  assert.deepEqual(names(sortRows(rows, null)), ["Zebra", "Aardvark"]);
});

test("sorting by name is alphabetical and reversible", () => {
  const rows = [row("1", { name: "Zebra" }), row("2", { name: "Aardvark" })];
  assert.deepEqual(names(sortRows(rows, { column: "name", direction: "asc" })), [
    "Aardvark",
    "Zebra",
  ]);
  assert.deepEqual(names(sortRows(rows, { column: "name", direction: "desc" })), [
    "Zebra",
    "Aardvark",
  ]);
});

test("sorting does not mutate the input", () => {
  const rows = [row("1", { name: "Zebra" }), row("2", { name: "Aardvark" })];
  sortRows(rows, { column: "name", direction: "asc" });
  assert.deepEqual(names(rows), ["Zebra", "Aardvark"], "original order preserved");
});

test("numeric columns sort numerically, not as text", () => {
  const rows = [
    row("1", { name: "Ten", cmc: 10 }),
    row("2", { name: "Two", cmc: 2 }),
    row("3", { name: "One", cmc: 1 }),
  ];
  assert.deepEqual(names(sortRows(rows, { column: "manaValue", direction: "asc" })), [
    "One",
    "Two",
    "Ten",
  ]);
});

test("a missing value sorts last in both directions", () => {
  const rows = [
    row("1", { name: "NoStats" }),
    row("2", { name: "Bear", power: "2", toughness: "2" }),
    row("3", { name: "Giant", power: "7", toughness: "7" }),
  ];

  assert.deepEqual(names(sortRows(rows, { column: "power", direction: "asc" })), [
    "Bear",
    "Giant",
    "NoStats",
  ]);
  assert.deepEqual(
    names(sortRows(rows, { column: "power", direction: "desc" })),
    ["Giant", "Bear", "NoStats"],
    "descending must not promote the card that has no power",
  );
});

test("unprintable power is treated as missing, not as zero", () => {
  const rows = [
    row("1", { name: "Tarmogoyf", power: "*" }),
    row("2", { name: "Bear", power: "2" }),
  ];
  assert.deepEqual(names(sortRows(rows, { column: "power", direction: "asc" })), [
    "Bear",
    "Tarmogoyf",
  ]);
});

test("collector numbers sort the way a person reads them", () => {
  const rows = [
    row("1", { name: "Ten", collector_number: "10" }),
    row("2", { name: "Two", collector_number: "2" }),
    row("3", { name: "Nine", collector_number: "9" }),
  ];
  assert.deepEqual(names(sortRows(rows, { column: "collector", direction: "asc" })), [
    "Two",
    "Nine",
    "Ten",
  ]);
});

test("unsorted rows sort after every named location", () => {
  const rows = [
    row("1", { name: "Loose" }),
    row("2", { name: "Filed" }, { locations: { id: "l1", name: "Binder", type: "binder" } }),
  ];
  assert.deepEqual(names(sortRows(rows, { column: "location", direction: "asc" })), [
    "Filed",
    "Loose",
  ]);
});

// ---------------------------------------------------------------------------
// Stored column choice
// ---------------------------------------------------------------------------

test("no stored choice means the defaults", () => {
  assert.deepEqual(parseStoredColumns(null), DEFAULT_COLUMNS);
  assert.deepEqual(parseStoredColumns(""), DEFAULT_COLUMNS);
});

test("a stored choice is honoured", () => {
  const chosen: ColumnId[] = ["name", "rarity", "artist"];
  assert.deepEqual(parseStoredColumns(JSON.stringify(chosen)), chosen);
});

test("unknown column ids are dropped rather than rendered", () => {
  // "price" used to be the example here and then became a real column, which
  // is exactly the trap: an id chosen because it did not exist yet.
  // "cost_basis" is not a column and is not on any roadmap.
  assert.deepEqual(parseStoredColumns(JSON.stringify(["name", "cost_basis", "nonsense"])), [
    "name",
  ]);
});

test("junk falls back to the defaults instead of throwing", () => {
  assert.deepEqual(parseStoredColumns("not json"), DEFAULT_COLUMNS);
  assert.deepEqual(parseStoredColumns(JSON.stringify({ name: true })), DEFAULT_COLUMNS);
  assert.deepEqual(
    parseStoredColumns(JSON.stringify(["cost_basis"])),
    DEFAULT_COLUMNS,
    "a choice with nothing valid left in it is not a choice",
  );
});

test("the default columns are quantity, name, set, price and availability", () => {
  // Availability joined the original three when decks arrived: "have I got a
  // spare copy" is the question this product exists to answer, and a column
  // hidden behind the picker would not answer it.
  //
  // Price joined them when the separate "$ Prices" toggle was retired. This
  // column is now the only switch for showing prices, so it has to start on —
  // and the order matters: it is asserted whole so a column silently changing
  // its default shows up here rather than in someone's table.
  assert.deepEqual(DEFAULT_COLUMNS, ["quantity", "name", "set", "price", "available"]);
});

test("a saved choice containing the retired Finish column still works", () => {
  // Finish was a column until foils moved to a mark beside the name. Anyone
  // who had it switched on has it sitting in localStorage; it should quietly
  // fall away rather than break their table.
  assert.deepEqual(parseStoredColumns(JSON.stringify(["quantity", "name", "finish", "set"])), [
    "quantity",
    "name",
    "set",
  ]);
});

test("a saved choice of nothing but Finish falls back to the defaults", () => {
  assert.deepEqual(parseStoredColumns(JSON.stringify(["finish"])), DEFAULT_COLUMNS);
});
