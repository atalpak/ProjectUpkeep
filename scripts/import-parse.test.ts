/**
 * Parser tests for the collection importer.
 *
 * The header samples below are modelled on real exports from Moxfield, ManaBox,
 * Archidekt and Deckbox. They are the reason the CSV reader is alias-driven:
 * four providers, four spellings of every column, and two different meanings
 * for "Edition".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseImport, splitDelimited } from "../src/lib/import/parse";
import { parseCondition, parseFinish, parseLanguage } from "../src/lib/import/vocabulary";

// ---------------------------------------------------------------------------
// Text decklists
// ---------------------------------------------------------------------------

test("reads a plain decklist", () => {
  const { rows, format } = parseImport("4 Lightning Bolt\n2 Counterspell");
  assert.equal(format, "text");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Lightning Bolt");
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[1].name, "Counterspell");
  assert.equal(rows[1].quantity, 2);
});

test("accepts the 4x spelling and a bare name", () => {
  const { rows } = parseImport("4x Lightning Bolt\nSol Ring");
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].name, "Lightning Bolt");
  assert.equal(rows[1].quantity, 1, "a bare name is one copy");
  assert.equal(rows[1].name, "Sol Ring");
});

test("pulls the set and collector number off a line", () => {
  const { rows } = parseImport("4 Lightning Bolt (2X2) 117");
  assert.equal(rows[0].name, "Lightning Bolt");
  assert.equal(rows[0].setHint, "2X2");
  assert.equal(rows[0].collectorNumber, "117");
});

test("reads square-bracket sets and a set with no collector number", () => {
  const { rows } = parseImport("1 Sol Ring [C21]");
  assert.equal(rows[0].name, "Sol Ring");
  assert.equal(rows[0].setHint, "C21");
  assert.equal(rows[0].collectorNumber, null);
});

test("understands Moxfield's foil markers", () => {
  const { rows } = parseImport("1 Sol Ring (C21) 263 *F*\n1 Sol Ring (C21) 263 *E*");
  assert.equal(rows[0].finish, "foil");
  assert.equal(rows[1].finish, "etched");
  assert.equal(rows[0].name, "Sol Ring", "the marker is not left on the name");
});

test("skips comments, blank lines and section headers", () => {
  const input = [
    "// my deck",
    "# a comment",
    "",
    "Deck",
    "4 Lightning Bolt",
    "Sideboard",
    "2 Negate",
  ].join("\n");

  const { rows, problems } = parseImport(input);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Lightning Bolt", "Negate"],
  );
  assert.equal(problems.length, 0);
});

test("strips the MTGO sideboard prefix", () => {
  const { rows } = parseImport("SB: 2 Negate");
  assert.equal(rows[0].name, "Negate");
  assert.equal(rows[0].quantity, 2);
});

test("keeps names that contain their own punctuation intact", () => {
  const { rows } = parseImport("1 Krark, the Thumbless\n1 Fable of the Mirror-Breaker");
  assert.equal(rows[0].name, "Krark, the Thumbless");
  assert.equal(rows[1].name, "Fable of the Mirror-Breaker");
});

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

test("reads a ManaBox export", () => {
  const csv = [
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Condition,Language",
    "Lightning Bolt,2x2,Double Masters 2022,117,normal,uncommon,4,abc-123,near_mint,en",
    "Sol Ring,c21,Commander 2021,263,foil,uncommon,1,def-456,lightly_played,ja",
  ].join("\n");

  const { rows, format, mappedColumns } = parseImport(csv);
  assert.equal(format, "csv");
  assert.equal(mappedColumns.setCode, "Set code");
  assert.equal(mappedColumns.setName, "Set name");

  assert.equal(rows[0].name, "Lightning Bolt");
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].setCode, "2x2");
  assert.equal(rows[0].collectorNumber, "117");
  assert.equal(rows[0].finish, "nonfoil");
  assert.equal(rows[0].condition, "NM");
  assert.equal(rows[0].language, "en");
  assert.equal(rows[0].scryfallId, "abc-123");

  assert.equal(rows[1].finish, "foil");
  assert.equal(rows[1].condition, "LP");
  assert.equal(rows[1].language, "ja");
});

test("reads a Moxfield export, where Edition is a set code", () => {
  const csv = [
    '"Count","Name","Edition","Condition","Language","Foil","Collector Number"',
    '"4","Lightning Bolt","2x2","NM","English","","117"',
    '"1","Sol Ring","c21","LP","English","foil","263"',
  ].join("\n");

  const { rows } = parseImport(csv);
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].setHint, "2x2", "Edition is ambiguous, so it lands in setHint");
  assert.equal(rows[0].collectorNumber, "117");
  assert.equal(
    rows[0].finish,
    null,
    "an empty foil cell is 'not stated', not an explicit non-foil",
  );
  assert.equal(rows[0].language, "en", "the label spelling maps to the code");
  assert.equal(rows[1].finish, "foil");
});

test("reads a Deckbox export, where Edition is a set name", () => {
  const csv = [
    "Count,Name,Edition,Card Number,Condition,Language,Foil",
    "2,Lightning Bolt,Magic 2011,149,Good (Lightly Played),English,",
  ].join("\n");

  const { rows } = parseImport(csv);
  assert.equal(rows[0].setHint, "Magic 2011");
  assert.equal(rows[0].collectorNumber, "149");
  assert.equal(rows[0].condition, "LP", "Deckbox's grading vocabulary maps onto ours");
});

test("reads an Archidekt export", () => {
  const csv = [
    "Quantity,Name,Finish,Condition,Language,Edition Name,Edition Code,Scryfall ID,Collector Number",
    "3,Counterspell,Foil,NM,English,Modern Horizons 2,mh2,ghi-789,267",
  ].join("\n");

  const { rows } = parseImport(csv);
  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].finish, "foil");
  assert.equal(rows[0].setCode, "mh2");
  assert.equal(rows[0].setName, "Modern Horizons 2");
  assert.equal(rows[0].scryfallId, "ghi-789");
});

test("handles quoted commas and doubled quotes in a cell", () => {
  const csv = ['Count,Name,Edition', '1,"Krark, the Thumbless",mh2', '1,"He Said ""No""",abc'].join(
    "\n",
  );
  const { rows } = parseImport(csv);
  assert.equal(rows[0].name, "Krark, the Thumbless");
  assert.equal(rows[1].name, 'He Said "No"');
});

test("reads a tab-separated export", () => {
  const tsv = ["Name\tCount\tEdition", "Lightning Bolt\t4\t2x2"].join("\n");
  const { rows, format } = parseImport(tsv);
  assert.equal(format, "csv");
  assert.equal(rows[0].name, "Lightning Bolt");
  assert.equal(rows[0].quantity, 4);
});

test("reports unusable rows instead of importing half of them", () => {
  const csv = ["Count,Name,Edition", "4,Lightning Bolt,2x2", "notanumber,Sol Ring,c21", ",,"].join(
    "\n",
  );
  const { rows, problems } = parseImport(csv);
  assert.equal(rows.length, 1, "only the good row survives");
  assert.equal(problems.length, 1, "the blank row is skipped, the bad quantity is reported");
  assert.match(problems[0].reason, /quantity/);
});

test("a decklist whose name contains a comma is not mistaken for a CSV", () => {
  const { format, rows } = parseImport("4 Krark, the Thumbless\n2 Counterspell");
  assert.equal(format, "text", "no header row means no CSV");
  assert.equal(rows[0].name, "Krark, the Thumbless");
});

test("empty input is empty, not an error", () => {
  const { rows, problems, format } = parseImport("   \n\n  ");
  assert.equal(format, "empty");
  assert.equal(rows.length, 0);
  assert.equal(problems.length, 0);
});

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test("finish aliases cover the providers we know about", () => {
  assert.equal(parseFinish("normal"), "nonfoil");
  assert.equal(parseFinish("Foil"), "foil");
  assert.equal(parseFinish("etched"), "etched");
  assert.equal(parseFinish("true"), "foil");
  assert.equal(parseFinish("false"), "nonfoil");
  assert.equal(parseFinish(""), null, "blank means not stated");
  assert.equal(parseFinish(null), null);
  assert.equal(parseFinish("holographic"), null, "unknown words do not guess");
});

test("condition aliases cover the providers we know about", () => {
  assert.equal(parseCondition("NM"), "NM");
  assert.equal(parseCondition("near_mint"), "NM");
  assert.equal(parseCondition("Near Mint"), "NM");
  assert.equal(parseCondition("Good (Lightly Played)"), "LP");
  assert.equal(parseCondition("heavily_played"), "HP");
  assert.equal(parseCondition("Poor"), "DMG");
  assert.equal(parseCondition("pristine"), null, "unknown grades do not guess");
});

test("language accepts codes and labels", () => {
  assert.equal(parseLanguage("en"), "en");
  assert.equal(parseLanguage("English"), "en");
  assert.equal(parseLanguage("Japanese"), "ja");
  assert.equal(parseLanguage("Simplified Chinese"), "zhs");
  assert.equal(parseLanguage("Klingon"), null);
});

// ---------------------------------------------------------------------------
// The delimiter reader itself
// ---------------------------------------------------------------------------

test("splitDelimited keeps newlines that are inside quotes", () => {
  const rows = splitDelimited('a,"line one\nline two",c', ",");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ["a", "line one\nline two", "c"]);
});
