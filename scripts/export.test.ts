/**
 * Export serialisation.
 *
 * The CSV half of this is held to a stricter bar than "looks right": it has
 * to survive a round trip through this app's own importer
 * (src/lib/import/parse.ts + vocabulary.ts), the same way a Moxfield or
 * Archidekt export would be expected to survive a round trip through theirs.
 * The text-decklist half targets *their* readers, not ours, so it is checked
 * against the format itself rather than our parser.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  csvField,
  deckToDecklistText,
  stacksToDecklistText,
  toCsv,
  type ExportRow,
} from "../src/lib/collection/export";
import { parseImport } from "../src/lib/import/parse";
import { parseCondition, parseLanguage } from "../src/lib/import/vocabulary";

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    card: { name: "Lightning Bolt", setCode: "m10", collectorNumber: "146" },
    quantity: 1,
    finish: "nonfoil",
    condition: "NM",
    language: "en",
    locationName: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Text decklist
// ---------------------------------------------------------------------------

test("a flat decklist is quantity + name + set + number", () => {
  const text = stacksToDecklistText([row({ quantity: 4 })]);
  assert.equal(text, "4 Lightning Bolt (M10) 146\n");
});

test("an empty collection exports to an empty string", () => {
  assert.equal(stacksToDecklistText([]), "");
});

test("foil and etched get Moxfield's *F*/*E* markers, nonfoil gets none", () => {
  assert.match(stacksToDecklistText([row({ finish: "foil" })]), /\*F\*$/m);
  assert.match(stacksToDecklistText([row({ finish: "etched" })]), /\*E\*$/m);
  assert.doesNotMatch(stacksToDecklistText([row({ finish: "nonfoil" })]), /\*[FE]\*/);
  assert.doesNotMatch(stacksToDecklistText([row({ finish: "glossy" })]), /\*[FE]\*/);
});

test("missing set or collector number is omitted, not printed as blank parens", () => {
  const text = stacksToDecklistText([
    row({ card: { name: "Sol Ring", setCode: null, collectorNumber: null } }),
  ]);
  assert.equal(text, "1 Sol Ring\n");
});

test("a card with no printing info at all still names it", () => {
  const text = stacksToDecklistText([row({ card: null })]);
  assert.equal(text, "1 Unknown card\n");
});

test("a deck export puts the commander in its own bare-header block", () => {
  const text = deckToDecklistText(row({ card: { name: "Atarka, World Render", setCode: "ktk", collectorNumber: "219" } }), [
    { label: "Creatures", rows: [row({ card: { name: "Llanowar Elves", setCode: "dom", collectorNumber: "179" } })] },
  ]);

  const lines = text.split("\n");
  assert.equal(lines[0], "Commander");
  assert.equal(lines[1], "1 Atarka, World Render (KTK) 219");
  assert.ok(lines.includes("# Creatures"));
  assert.ok(lines.includes("1 Llanowar Elves (DOM) 179"));
});

test("a deck export with no commander skips that block entirely", () => {
  const text = deckToDecklistText(null, [{ label: "Lands", rows: [row({ card: { name: "Forest", setCode: null, collectorNumber: null } })] }]);
  assert.ok(!text.includes("Commander"));
  assert.ok(text.startsWith("# Lands"));
});

test("empty sections are dropped rather than printing a bare heading", () => {
  const text = deckToDecklistText(null, [
    { label: "Creatures", rows: [] },
    { label: "Lands", rows: [row({ card: { name: "Forest", setCode: null, collectorNumber: null } })] },
  ]);
  assert.ok(!text.includes("# Creatures"));
  assert.ok(text.includes("# Lands"));
});

// ---------------------------------------------------------------------------
// CSV escaping
// ---------------------------------------------------------------------------

test("plain values pass through unquoted", () => {
  assert.equal(csvField("Lightning Bolt"), "Lightning Bolt");
});

test("a comma in a name is quoted", () => {
  // Plenty of Magic cards have one, e.g. "Krenko, Mob Boss".
  assert.equal(csvField("Krenko, Mob Boss"), '"Krenko, Mob Boss"');
});

test("a quote in a name is doubled and the field quoted", () => {
  // e.g. "Kongming, \"Sleeping Dragon\"" style names.
  assert.equal(csvField('Kongming, "Sleeping Dragon"'), '"Kongming, ""Sleeping Dragon"""');
});

test("a newline in a field is quoted", () => {
  assert.equal(csvField("line one\nline two"), '"line one\nline two"');
});

test("CSV rows use CRLF, including after the header", () => {
  const csv = toCsv([row()], { includeLocation: false });
  assert.ok(csv.includes("\r\n"));
  assert.equal(csv.split("\r\n")[0], "Name,Set Code,Collector Number,Finish,Condition,Language,Quantity");
});

test("the Location column only appears when asked for", () => {
  const withLocation = toCsv([row({ locationName: "Commander Binder" })], { includeLocation: true });
  const without = toCsv([row()], { includeLocation: false });
  assert.match(withLocation, /Location/);
  assert.match(withLocation, /Commander Binder/);
  assert.doesNotMatch(without, /Location/);
});

test("an empty collection still produces just the header", () => {
  const csv = toCsv([], { includeLocation: true });
  assert.equal(csv, "Name,Set Code,Collector Number,Finish,Condition,Language,Quantity,Location\r\n");
});

// ---------------------------------------------------------------------------
// The critical bit: CSV round-trips through this app's own importer.
// ---------------------------------------------------------------------------

test("an exported CSV imports cleanly back into this app", () => {
  const rows: ExportRow[] = [
    row({
      card: { name: "Krenko, Mob Boss", setCode: "c17", collectorNumber: "13" },
      quantity: 3,
      finish: "foil",
      condition: "LP",
      language: "en",
      locationName: "Commander Binder",
    }),
    row({
      card: { name: "Lightning Bolt", setCode: "lea", collectorNumber: "161" },
      quantity: 1,
      finish: "nonfoil",
      condition: "NM",
      language: "ja",
      locationName: null,
    }),
  ];

  const csv = toCsv(rows, { includeLocation: true });
  const { rows: parsed, problems, format } = parseImport(csv);

  assert.equal(format, "csv");
  assert.deepEqual(problems, []);
  assert.equal(parsed.length, 2);

  assert.equal(parsed[0].name, "Krenko, Mob Boss");
  assert.equal(parsed[0].setCode, "c17");
  assert.equal(parsed[0].collectorNumber, "13");
  assert.equal(parsed[0].quantity, 3);
  assert.equal(parsed[0].finish, "foil");
  assert.equal(parsed[0].condition, "LP");
  assert.equal(parsed[0].language, "en");

  assert.equal(parsed[1].name, "Lightning Bolt");
  assert.equal(parsed[1].setCode, "lea");
  assert.equal(parsed[1].collectorNumber, "161");
  assert.equal(parsed[1].condition, "NM");
  assert.equal(parsed[1].language, "ja");

  // And the vocabulary module reads our own raw values straight through, with
  // no alias needed — the whole point of exporting values already in this
  // app's own vocabulary rather than a human-readable label.
  assert.equal(parseCondition("LP"), "LP");
  assert.equal(parseLanguage("ja"), "ja");
});

test("a comma-and-quote-bearing name round-trips through the importer intact", () => {
  const rows: ExportRow[] = [
    row({ card: { name: 'Kongming, "Sleeping Dragon"', setCode: "sld", collectorNumber: "1" } }),
  ];
  const csv = toCsv(rows, { includeLocation: false });
  const { rows: parsed } = parseImport(csv);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Kongming, "Sleeping Dragon"');
});
