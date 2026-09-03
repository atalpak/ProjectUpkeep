import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDeckStats, priceFinishFor } from "../src/lib/collection/deck-stats";
import type { DeckListEntry } from "../src/lib/collection/queries";
import type { Card, Finish } from "../src/lib/types";

let seq = 0;

function entry(over: {
  id?: string;
  quantity?: number;
  type_line?: string;
  cmc?: number | null;
  color_identity?: string[] | null;
  mana_cost?: string | null;
  price_usd?: number | null;
  price_usd_foil?: number | null;
  available_finishes?: string[];
  sleevedFinishes?: Finish[];
}): DeckListEntry {
  const id = over.id ?? `e${++seq}`;
  const card = {
    scryfall_id: `c-${id}`,
    name: `Card ${id}`,
    type_line: over.type_line ?? "Creature — Human",
    cmc: over.cmc === undefined ? 2 : over.cmc,
    color_identity: over.color_identity === undefined ? ["G"] : over.color_identity,
    mana_cost: over.mana_cost ?? null,
    available_finishes: over.available_finishes ?? ["nonfoil"],
    price_usd: over.price_usd === undefined ? 1 : over.price_usd,
    price_usd_foil: over.price_usd_foil ?? null,
    price_usd_etched: null,
  } as unknown as Card;

  return {
    id,
    deck_id: "d1",
    card_id: card.scryfall_id,
    quantity: over.quantity ?? 1,
    cards: card,
    sleeved: 0,
    sleevedFinishes: over.sleevedFinishes ?? [],
  };
}

test("price totals by section, and reports what it could not price", () => {
  const stats = computeDeckStats(
    [
      entry({ type_line: "Creature — Elf", price_usd: 2, quantity: 3 }), // 6
      entry({ type_line: "Instant", price_usd: 0.5, quantity: 2 }), // 1
      entry({ type_line: "Instant", price_usd: null, quantity: 1 }), // unpriced
      entry({ type_line: "Land", price_usd: 10, quantity: 1 }), // 10
    ],
    null,
  );

  assert.equal(stats.price.total, 17);
  assert.equal(stats.price.priced, 6);
  assert.equal(stats.price.unpriced, 1);
  assert.equal(stats.price.cards, 7);

  const bySection = Object.fromEntries(stats.price.sections.map((s) => [s.section, s]));
  assert.equal(bySection.creatures.total, 6);
  assert.equal(bySection.instants.total, 1);
  assert.equal(bySection.instants.unpriced, 1);
  assert.equal(bySection.lands.total, 10);
});

test("a lone sleeved foil prices at the foil price", () => {
  const stats = computeDeckStats(
    [entry({ price_usd: 1, price_usd_foil: 9, sleevedFinishes: ["foil"], quantity: 2 })],
    null,
  );
  assert.equal(stats.price.total, 18);
});

test("curve buckets non-lands by mana value, 7+ collapsed, split by type", () => {
  const stats = computeDeckStats(
    [
      entry({ type_line: "Creature", cmc: 1, quantity: 4 }),
      entry({ type_line: "Instant", cmc: 1, quantity: 2 }),
      entry({ type_line: "Creature", cmc: 7, quantity: 1 }),
      entry({ type_line: "Creature", cmc: 9, quantity: 1 }),
      entry({ type_line: "Land", cmc: null, quantity: 20 }),
    ],
    null,
  );

  const at = (label: string) => stats.curve.find((b) => b.label === label)!;
  assert.equal(at("1").total, 6);
  assert.equal(at("1").segments.find((s) => s.section === "creatures")!.count, 4);
  assert.equal(at("1").segments.find((s) => s.section === "instants")!.count, 2);
  assert.equal(at("7+").total, 2, "cmc 7 and 9 both land in 7+");
  assert.equal(at("0").total, 0, "lands do not appear on the curve");
  assert.equal(stats.curve.length, 8);
});

test("colours count by identity — a two-colour card counts under both", () => {
  const stats = computeDeckStats(
    [
      entry({ color_identity: ["G"], quantity: 3 }),
      entry({ color_identity: ["B", "G"], quantity: 2 }),
      entry({ color_identity: [], quantity: 5 }),
    ],
    null,
  );

  const by = Object.fromEntries(stats.colors.map((c) => [c.code, c.count]));
  assert.equal(by.G, 5, "3 mono-green + 2 golgari");
  assert.equal(by.B, 2);
  assert.equal(by.C, 5);
  assert.equal(by.W, undefined, "empty colours are dropped");
});

test("priceFinishFor: sleeved finish wins, else the printing's default", () => {
  // Nothing sleeved, comes in non-foil → non-foil.
  assert.equal(priceFinishFor(entry({ available_finishes: ["nonfoil", "foil"] })), "nonfoil");
  // Nothing sleeved, foil-only printing (Foundations Commander) → foil.
  assert.equal(priceFinishFor(entry({ available_finishes: ["foil"] })), "foil");
  // One foil sleeved → foil, whatever the printing offers.
  assert.equal(
    priceFinishFor(entry({ available_finishes: ["nonfoil", "foil"], sleevedFinishes: ["foil"] })),
    "foil",
  );
});

test("a foil-only printing is priced at its foil price, not shown blank", () => {
  const stats = computeDeckStats(
    [
      entry({
        type_line: "Artifact",
        available_finishes: ["foil"],
        price_usd: null,
        price_usd_foil: 0.58,
        quantity: 1,
      }),
    ],
    null,
  );
  assert.equal(stats.price.total, 0.58);
  assert.equal(stats.price.unpriced, 0);
});

test("colour shares: card identity vs mana pips", () => {
  const stats = computeDeckStats(
    [
      // 1 mono-green creature, {G}{G} — 2 green pips
      entry({ color_identity: ["G"], mana_cost: "{G}{G}", quantity: 1 }),
      // 3 golgari spells, {1}{B}{G} — 3 black + 3 green pips
      entry({ color_identity: ["B", "G"], mana_cost: "{1}{B}{G}", quantity: 3 }),
    ],
    null,
  );
  const by = Object.fromEntries(stats.colors.map((c) => [c.code, c]));

  // 4 cards total. Green is on all 4, black on 3.
  assert.equal(by.G.count, 4);
  assert.equal(by.B.count, 3);
  assert.equal(Math.round(by.G.cardShare * 100), 100);
  assert.equal(Math.round(by.B.cardShare * 100), 75);

  // Pips: green 2 + 3 = 5, black 3. Total coloured pips 8.
  assert.equal(by.G.pips, 5);
  assert.equal(by.B.pips, 3);
  assert.equal(Math.round(by.G.pipShare * 100), 63);
  assert.equal(Math.round(by.B.pipShare * 100), 38);
});

test("hybrid pips count toward each colour", () => {
  const stats = computeDeckStats([entry({ mana_cost: "{R/G}", color_identity: ["R", "G"] })], null);
  const by = Object.fromEntries(stats.colors.map((c) => [c.code, c]));
  assert.equal(by.R.pips, 1);
  assert.equal(by.G.pips, 1);
});

test("the nominated commander is its own price section", () => {
  const cmd = entry({ id: "cmd", type_line: "Legendary Creature — God", price_usd: 5 });
  const stats = computeDeckStats([cmd, entry({ type_line: "Creature", price_usd: 1 })], "cmd");

  const sections = stats.price.sections.map((s) => s.section);
  assert.ok(sections.includes("commander"));
  assert.equal(stats.price.sections.find((s) => s.section === "commander")!.total, 5);
  assert.equal(stats.price.sections.find((s) => s.section === "creatures")!.total, 1);
});
