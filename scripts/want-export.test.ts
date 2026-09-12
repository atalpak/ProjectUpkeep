/**
 * Wish-list export serialisation.
 *
 * The CSV is a strict subset of the collection's own header (no finish,
 * condition, language or location — a want has none of those), which is what
 * lets it round-trip through the same importer used for the collection and
 * the deck list, checked here the same way scripts/export.test.ts checks the
 * collection's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { wantsToCsv, wantsToDecklistText, type WantExportRow } from "../src/lib/social/want-export";
import { parseImport } from "../src/lib/import/parse";

function row(overrides: Partial<WantExportRow> = {}): WantExportRow {
  return { name: "Lightning Bolt", setCode: "m10", collectorNumber: "146", quantity: 1, ...overrides };
}

test("a flat wish-list decklist is quantity + name + set + number", () => {
  assert.equal(wantsToDecklistText([row({ quantity: 4 })]), "4 Lightning Bolt (M10) 146\n");
});

test("an empty wish list exports to an empty string", () => {
  assert.equal(wantsToDecklistText([]), "");
});

test("missing set or collector number is omitted, not printed as blank parens", () => {
  const text = wantsToDecklistText([row({ setCode: null, collectorNumber: null })]);
  assert.equal(text, "1 Lightning Bolt\n");
});

test("the CSV header carries no finish/condition/language/location columns", () => {
  const csv = wantsToCsv([row()]);
  assert.equal(csv.split("\r\n")[0], "Name,Set Code,Collector Number,Quantity");
});

test("a comma-bearing name is quoted", () => {
  const csv = wantsToCsv([row({ name: "Krenko, Mob Boss" })]);
  assert.match(csv, /"Krenko, Mob Boss"/);
});

test("an exported wish-list CSV imports cleanly back into this app", () => {
  const rows: WantExportRow[] = [
    row({ name: "Krenko, Mob Boss", setCode: "c17", collectorNumber: "13", quantity: 3 }),
    row({ name: "Sol Ring", setCode: null, collectorNumber: null, quantity: 1 }),
  ];

  const csv = wantsToCsv(rows);
  const { rows: parsed, problems, format } = parseImport(csv);

  assert.equal(format, "csv");
  assert.deepEqual(problems, []);
  assert.equal(parsed.length, 2);

  assert.equal(parsed[0].name, "Krenko, Mob Boss");
  assert.equal(parsed[0].setCode, "c17");
  assert.equal(parsed[0].collectorNumber, "13");
  assert.equal(parsed[0].quantity, 3);

  assert.equal(parsed[1].name, "Sol Ring");
  assert.equal(parsed[1].quantity, 1);
});
