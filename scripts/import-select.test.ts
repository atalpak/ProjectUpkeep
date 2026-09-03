/**
 * Which printing an imported line resolves to.
 *
 * This is the policy that decides what someone actually ends up owning when
 * their file says "4 Lightning Bolt" and we hold 67 paper printings of it, so
 * it is worth pinning down separately from the queries that feed it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { choosePrinting, preferred, type MatchedCard } from "../src/lib/import/select";
import type { ParsedRow } from "../src/lib/import/parse";

function card(overrides: Partial<MatchedCard> = {}): MatchedCard {
  return {
    scryfall_id: "id",
    name: "Lightning Bolt",
    set_code: "2x2",
    set_name: "Double Masters 2022",
    collector_number: "117",
    image_uri_small: null,
    available_finishes: ["nonfoil", "foil"],
    released_at: "2022-07-08",
    digital: false,
    ...overrides,
  };
}

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    line: 1,
    raw: "4 Lightning Bolt",
    quantity: 4,
    name: "Lightning Bolt",
    setCode: null,
    setName: null,
    setHint: null,
    collectorNumber: null,
    finish: null,
    condition: null,
    language: null,
    scryfallId: null,
    ...overrides,
  };
}

test("nothing to choose from is not a match", () => {
  assert.equal(choosePrinting(row(), []), null);
});

test("a single printing is chosen without comment", () => {
  const result = choosePrinting(row(), [card()]);
  assert.equal(result?.card.set_code, "2x2");
  assert.equal(result?.warning, null);
});

test("an explicit set code narrows the choice", () => {
  const result = choosePrinting(row({ setCode: "lea" }), [
    card({ set_code: "2x2" }),
    card({ set_code: "lea", collector_number: "161" }),
  ]);
  assert.equal(result?.card.set_code, "lea");
  assert.equal(result?.warning, null);
});

test("an ambiguous Edition column is tried as both code and name", () => {
  const byCode = choosePrinting(row({ setHint: "lea" }), [
    card({ set_code: "2x2" }),
    card({ set_code: "lea", set_name: "Limited Edition Alpha" }),
  ]);
  assert.equal(byCode?.card.set_code, "lea");

  const byName = choosePrinting(row({ setHint: "Limited Edition Alpha" }), [
    card({ set_code: "2x2" }),
    card({ set_code: "lea", set_name: "Limited Edition Alpha" }),
  ]);
  assert.equal(byName?.card.set_code, "lea");
});

test("a collector number picks the exact printing within a set", () => {
  const result = choosePrinting(row({ setCode: "sld", collectorNumber: "1508" }), [
    card({ set_code: "sld", collector_number: "1507" }),
    card({ set_code: "sld", collector_number: "1508" }),
  ]);
  assert.equal(result?.card.collector_number, "1508");
  assert.equal(result?.warning, null);
});

test("a set we do not have still resolves, and says what it did", () => {
  const result = choosePrinting(row({ setHint: "zzz" }), [card({ set_code: "2x2" })]);
  assert.equal(result?.card.set_code, "2x2");
  assert.match(result?.warning ?? "", /No printing found in "zzz"/);
});

test("a collector number we do not have falls back within the set, and says so", () => {
  const result = choosePrinting(row({ setCode: "2x2", collectorNumber: "999" }), [
    card({ set_code: "2x2", collector_number: "117" }),
  ]);
  assert.equal(result?.card.collector_number, "117");
  assert.match(result?.warning ?? "", /No #999/);
});

test("an unqualified name with several printings warns about the pick", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "lea", released_at: "1993-08-05" }),
    card({ set_code: "2x2", released_at: "2022-07-08" }),
  ]);
  assert.match(result?.warning ?? "", /2 printings/);
});

test("digital-only printings lose to paper ones", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "mtgo", digital: true, released_at: "2030-01-01" }),
    card({ set_code: "2x2", digital: false, released_at: "2022-07-08" }),
  ]);
  assert.equal(result?.card.set_code, "2x2", "a newer digital printing must not win");
});

test("preferred sorts newest first among paper printings", () => {
  const sorted = [
    card({ set_code: "lea", released_at: "1993-08-05" }),
    card({ set_code: "2x2", released_at: "2022-07-08" }),
  ].sort(preferred);
  assert.equal(sorted[0].set_code, "2x2");
});

// ---------------------------------------------------------------------------
// Set-type ranking (migration 00000000000007)
// ---------------------------------------------------------------------------

test("an ordinary printing beats a newer promo", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "plst", set_type: "memorabilia", released_at: "2026-11-09" }),
    card({ set_code: "neo", set_type: "expansion", released_at: "2022-02-18" }),
  ]);
  assert.equal(
    result?.card.set_code,
    "neo",
    "a real expansion is what '4 Lightning Bolt' means, not The List",
  );
});

test("Secret Lair loses to a normal set", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "sld", set_type: "box", released_at: "2026-09-14" }),
    card({ set_code: "m11", set_type: "core", released_at: "2010-07-16" }),
  ]);
  assert.equal(result?.card.set_code, "m11");
});

test("among equals, newest still wins", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "lea", set_type: "core", released_at: "1993-08-05" }),
    card({ set_code: "m11", set_type: "core", released_at: "2010-07-16" }),
  ]);
  assert.equal(result?.card.set_code, "m11");
});

test("an explicit set still overrides the ranking", () => {
  const result = choosePrinting(row({ setCode: "plst" }), [
    card({ set_code: "plst", set_type: "memorabilia", released_at: "2026-11-09" }),
    card({ set_code: "neo", set_type: "expansion", released_at: "2022-02-18" }),
  ]);
  assert.equal(result?.card.set_code, "plst", "asking for the promo gets the promo");
});

test("rows synced before the migration rank equally and fall back to newest", () => {
  const result = choosePrinting(row(), [
    card({ set_code: "plst", set_type: null, released_at: "2026-11-09" }),
    card({ set_code: "neo", set_type: null, released_at: "2022-02-18" }),
  ]);
  assert.equal(result?.card.set_code, "plst", "no set_type means the old behaviour");
});
