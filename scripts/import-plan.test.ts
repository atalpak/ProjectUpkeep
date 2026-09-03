/**
 * Planning tests: what an import will actually write.
 *
 * These run against fabricated resolved rows rather than the database, because
 * the questions they answer — does a foil request survive on a non-foil-only
 * printing, do duplicate lines combine — are policy questions, not storage ones.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planImport, type ImportDefaults } from "../src/lib/import/plan";
import type { MatchedCard, ResolvedRow } from "../src/lib/import/resolve";
import type { ParsedRow } from "../src/lib/import/parse";

const DEFAULTS: ImportDefaults = {
  condition: "NM",
  finish: "nonfoil",
  language: "en",
  locationId: "binder-1",
};

function card(overrides: Partial<MatchedCard> = {}): MatchedCard {
  return {
    scryfall_id: "card-1",
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

function row(overrides: Partial<ResolvedRow> = {}): ResolvedRow {
  const base: ParsedRow = {
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
  };
  return { ...base, card: card(), reason: null, warning: null, ...overrides };
}

test("fills unstated fields from the import defaults", () => {
  const plan = planImport([row()], DEFAULTS);
  assert.equal(plan.rows[0].condition, "NM");
  assert.equal(plan.rows[0].finish, "nonfoil");
  assert.equal(plan.rows[0].language, "en");
  assert.equal(plan.stacks[0].location_id, "binder-1");
});

test("what the file states beats the defaults", () => {
  const plan = planImport(
    [row({ condition: "MP", finish: "foil", language: "ja" })],
    DEFAULTS,
  );
  assert.equal(plan.rows[0].condition, "MP");
  assert.equal(plan.rows[0].finish, "foil");
  assert.equal(plan.rows[0].language, "ja");
});

test("refuses a finish the printing does not come in, and says so", () => {
  const plan = planImport(
    [row({ finish: "foil", card: card({ available_finishes: ["nonfoil"] }) })],
    DEFAULTS,
  );
  assert.equal(plan.rows[0].finish, "nonfoil");
  assert.match(plan.rows[0].warnings.join(" "), /no foil version/i);
});

test("trusts the file when the printing lists no finishes at all", () => {
  const plan = planImport(
    [row({ finish: "foil", card: card({ available_finishes: [] }) })],
    DEFAULTS,
  );
  assert.equal(plan.rows[0].finish, "foil", "no evidence is not evidence against");
  assert.equal(plan.rows[0].warnings.length, 0);
});

test("identical rows combine into one stack", () => {
  const plan = planImport(
    [row({ line: 1, quantity: 4 }), row({ line: 2, quantity: 3 })],
    DEFAULTS,
  );
  assert.equal(plan.stacks.length, 1);
  assert.equal(plan.stacks[0].quantity, 7);
  assert.deepEqual(plan.stacks[0].lines, [1, 2]);
  assert.equal(plan.totalCards, 7);
  assert.equal(plan.matchedRows, 2);
});

test("rows that differ in any stacked dimension stay apart", () => {
  const plan = planImport(
    [
      row({ line: 1 }),
      row({ line: 2, finish: "foil" }),
      row({ line: 3, condition: "LP" }),
      row({ line: 4, language: "ja" }),
      row({ line: 5, card: card({ scryfall_id: "card-2" }) }),
    ],
    DEFAULTS,
  );
  assert.equal(plan.stacks.length, 5);
});

test("unmatched rows are carried, not written", () => {
  const plan = planImport(
    [row({ line: 1 }), row({ line: 2, card: null, reason: "No card with that name." })],
    DEFAULTS,
  );
  assert.equal(plan.stacks.length, 1, "only the matched row is written");
  assert.equal(plan.matchedRows, 1);
  assert.equal(plan.skippedRows.length, 1);
  assert.equal(plan.skippedRows[0].line, 2);
  assert.equal(plan.totalCards, 4, "the skipped row's quantity is not counted");
});

test("a resolver warning survives into the plan", () => {
  const plan = planImport([row({ warning: "76 printings — filed the 2X2 one." })], DEFAULTS);
  assert.match(plan.rows[0].warnings.join(" "), /76 printings/);
});

test("unsorted is a real destination, not a missing one", () => {
  const plan = planImport([row()], { ...DEFAULTS, locationId: null });
  assert.equal(plan.stacks[0].location_id, null);
  assert.equal(plan.stacks.length, 1);
});
