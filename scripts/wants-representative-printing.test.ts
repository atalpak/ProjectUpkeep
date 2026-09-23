/**
 * pickRepresentative (src/app/(app)/wants/actions.ts): choosing a default
 * printing for a wish-list entry added by name.
 *
 * A card's printings inside one set share a release date, so ranking by
 * set-type then release date alone leaves same-set printings tied. The
 * scanner side hit the identical bug (packages/scan-core's `regularFirst`,
 * see its header) — a footer read once opened a foil-only showcase printing
 * instead of the ordinary card. This file proves the web wish-list default
 * doesn't have the same problem: given a plain regular printing and a
 * same-day foil-only showcase printing, it must pick the regular one.
 *
 * Run with: npx tsx --test scripts/wants-representative-printing.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { pickRepresentative } from "../src/app/(app)/wants/actions";

test("a same-day tie prefers the plain collector number over a promo/showcase suffix", () => {
  const regular = {
    scryfall_id: "regular",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "ecl",
    collector_number: "91",
    available_finishes: ["nonfoil", "foil"],
  };
  const showcase = {
    scryfall_id: "showcase",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "ecl",
    collector_number: "385",
    available_finishes: ["foil"],
  };

  // Order shouldn't matter — this used to fall through to whatever order
  // the database happened to return.
  assert.equal(pickRepresentative([regular, showcase]), "regular");
  assert.equal(pickRepresentative([showcase, regular]), "regular");
});

test("between two plain-numbered printings, nonfoil availability outranks a lower collector number", () => {
  const foilOnlyLowerNumber = {
    scryfall_id: "foil-only",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "abc",
    collector_number: "12",
    available_finishes: ["foil"],
  };
  const nonfoilHigherNumber = {
    scryfall_id: "nonfoil",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "abc",
    collector_number: "13",
    available_finishes: ["nonfoil"],
  };

  assert.equal(pickRepresentative([foilOnlyLowerNumber, nonfoilHigherNumber]), "nonfoil");
  assert.equal(pickRepresentative([nonfoilHigherNumber, foilOnlyLowerNumber]), "nonfoil");
});

test("a promo-suffixed number never beats a plain number, even if the promo is nonfoil", () => {
  const plainFoilOnly = {
    scryfall_id: "plain",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "abc",
    collector_number: "12",
    available_finishes: ["foil"],
  };
  const promoNonfoil = {
    scryfall_id: "promo",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "abc",
    collector_number: "12p",
    available_finishes: ["nonfoil"],
  };

  assert.equal(pickRepresentative([plainFoilOnly, promoNonfoil]), "plain");
});

test("across different release dates, the newest of the preferred set type still wins", () => {
  const older = {
    scryfall_id: "older",
    released_at: "2020-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "old",
    collector_number: "1",
    available_finishes: ["nonfoil"],
  };
  const newer = {
    scryfall_id: "newer",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: false,
    set_code: "new",
    collector_number: "1",
    available_finishes: ["nonfoil"],
  };

  assert.equal(pickRepresentative([older, newer]), "newer");
});

test("set-type rank still beats a later release date (avoid Masters/Commander/Starter as the default)", () => {
  const coreSet = {
    scryfall_id: "core",
    released_at: "2020-01-01",
    set_type: "core",
    digital: false,
    set_code: "core",
    collector_number: "1",
    available_finishes: ["nonfoil"],
  };
  const mastersSet = {
    scryfall_id: "masters",
    released_at: "2024-01-01",
    set_type: "masters",
    digital: false,
    set_code: "mst",
    collector_number: "1",
    available_finishes: ["nonfoil"],
  };

  assert.equal(pickRepresentative([mastersSet, coreSet]), "core");
});

test("a digital-only pool still returns a pick rather than null", () => {
  const digitalOnly = {
    scryfall_id: "digital",
    released_at: "2024-01-01",
    set_type: "expansion",
    digital: true,
    set_code: "dgt",
    collector_number: "1",
    available_finishes: ["nonfoil"],
  };

  assert.equal(pickRepresentative([digitalOnly]), "digital");
});

test("an empty pool returns null", () => {
  assert.equal(pickRepresentative([]), null);
});
