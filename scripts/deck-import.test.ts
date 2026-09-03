import assert from "node:assert/strict";
import { test } from "node:test";

import { planDeckImport, splitAgainstDeck } from "../src/lib/import/deck-plan";
import type { ResolvedRow } from "../src/lib/import/resolve";

const matched = (over: Partial<ResolvedRow> & { id?: string } = {}): ResolvedRow => ({
  line: over.line ?? 1,
  raw: over.raw ?? "1 Sol Ring",
  quantity: over.quantity ?? 1,
  name: over.name ?? "Sol Ring",
  setCode: null,
  setName: null,
  setHint: null,
  collectorNumber: null,
  finish: null,
  condition: null,
  language: null,
  scryfallId: null,
  reason: null,
  warning: null,
  card:
    over.card === null
      ? null
      : {
          scryfall_id: over.id ?? "sol-c21",
          name: over.name ?? "Sol Ring",
          set_code: "c21",
          set_name: "Commander 2021",
          collector_number: "263",
          image_uri_small: "https://img/sol.jpg",
          available_finishes: ["nonfoil"],
          released_at: "2021-04-23",
          digital: false,
        },
});

const unmatched = (line: number, raw: string, reason: string): ResolvedRow => ({
  ...matched({ line, raw }),
  card: null,
  reason,
});

test("folds duplicate lines of the same card into one, summing quantity", () => {
  const plan = planDeckImport([
    matched({ line: 1, id: "sol-c21", quantity: 1 }),
    matched({ line: 5, id: "sol-c21", quantity: 3 }),
  ]);

  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].quantity, 4);
  assert.equal(plan.lines[0].line, 1, "keeps the first line it was seen on");
  assert.equal(plan.totalCards, 4);
});

test("different printings of one name fold into a single entry", () => {
  const plan = planDeckImport([
    matched({ id: "bolt-2x2", name: "Lightning Bolt", quantity: 2, line: 1 }),
    matched({ id: "bolt-mh2", name: "Lightning Bolt", quantity: 1, line: 4 }),
  ]);

  assert.equal(plan.lines.length, 1, "one decklist entry per card name");
  assert.equal(plan.lines[0].quantity, 3);
  assert.equal(plan.lines[0].cardId, "bolt-2x2", "keeps the first printing seen");
});

test("name folding ignores case", () => {
  const plan = planDeckImport([
    matched({ id: "a", name: "Forest", quantity: 10 }),
    matched({ id: "b", name: "forest", quantity: 4 }),
  ]);

  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].quantity, 14);
});

test("builds a human label and carries the image + set code", () => {
  const [line] = planDeckImport([matched({ id: "sol-c21" })]).lines;
  assert.equal(line.matched, "Sol Ring · C21 #263");
  assert.equal(line.setCode, "c21");
  assert.equal(line.imageUri, "https://img/sol.jpg");
});

test("unmatched rows are collected with their reason, not counted", () => {
  const plan = planDeckImport([
    matched({ quantity: 2 }),
    unmatched(3, "2 Definitely Not A Card", "No matching card."),
  ]);

  assert.equal(plan.lines.length, 1);
  assert.equal(plan.totalCards, 2);
  assert.deepEqual(plan.unmatched, [
    { line: 3, raw: "2 Definitely Not A Card", reason: "No matching card." },
  ]);
});

test("splitAgainstDeck counts new vs already-listed by card name", () => {
  const { lines } = planDeckImport([
    matched({ id: "sol-c21", name: "Sol Ring" }),
    matched({ id: "bolt-2x2", name: "Lightning Bolt" }),
    matched({ id: "rift-mh2", name: "Cyclonic Rift" }),
  ]);

  // Deck already lists these two, by whatever printing — matched by name.
  const split = splitAgainstDeck(lines, ["Lightning Bolt", "cyclonic rift"]);
  assert.deepEqual(split, { newEntries: 1, mergedEntries: 2 });
});
