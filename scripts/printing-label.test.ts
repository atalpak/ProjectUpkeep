/**
 * Tests for the text beside a printing's thumbnail.
 *
 * Run with: npx tsx --test scripts/printing-label.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { finishesLabel, printingSummary } from "../src/lib/cards/printing-label";

test("a full printing reads set, number, year, rarity and finishes", () => {
  assert.deepEqual(
    printingSummary({
      set_code: "m21",
      set_name: "Core Set 2021",
      collector_number: "199",
      released_at: "2020-07-03",
      rarity: "rare",
      available_finishes: ["nonfoil", "foil"],
    }),
    { title: "Core Set 2021", detail: "#199 · 2020 · rare · Non-foil, Foil" },
  );
});

test("a missing set name falls back to the upper-cased code, then to a placeholder", () => {
  const base = { collector_number: null, released_at: null };
  assert.equal(printingSummary({ ...base, set_code: "m21", set_name: null }).title, "M21");
  assert.equal(printingSummary({ ...base, set_code: null, set_name: null }).title, "Unknown set");
});

test("absent facts are left out rather than printed as blanks", () => {
  assert.equal(
    printingSummary({ set_code: "m21", set_name: "X", collector_number: "5", released_at: null }).detail,
    "#5",
  );
});

test("finish names are readable and an unknown finish passes through", () => {
  assert.equal(finishesLabel(["etched"]), "Etched foil");
  assert.equal(finishesLabel(["mystery"]), "mystery");
  assert.equal(finishesLabel([]), "");
  assert.equal(finishesLabel(null), "");
});
