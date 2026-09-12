/**
 * buildLibrary: turning a decklist into a shuffleable pile of copies.
 *
 * The "built" mode test is the important one here. `sleeved` on a
 * `DeckListEntry` is a total shared across every entry for the same card
 * (see the module header on library.ts and migration 20's "100 cards became
 * 114"), so the case worth pinning down is one card listed under two
 * printings, both reporting the same sleeved total.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLibrary } from "../src/lib/playtest/library";
import type { DeckListEntry } from "../src/lib/collection/queries";
import type { Card } from "../src/lib/types";

let seq = 0;

function card(over: Partial<Card> & { name: string; oracle_id?: string | null }): Card {
  const id = `c-${++seq}`;
  return {
    scryfall_id: over.scryfall_id ?? id,
    oracle_id: over.oracle_id === undefined ? `oracle-${over.name}` : over.oracle_id,
    name: over.name,
    type_line: over.type_line ?? "Creature — Human",
    mana_cost: over.mana_cost ?? null,
    cmc: over.cmc === undefined ? 1 : over.cmc,
    image_uri: over.image_uri ?? null,
    produced_mana: over.produced_mana ?? null,
  } as unknown as Card;
}

function entry(over: {
  id?: string;
  card_id?: string;
  quantity: number;
  sleeved?: number;
  cards: Card | null;
}): DeckListEntry {
  const id = over.id ?? `e-${++seq}`;
  return {
    id,
    deck_id: "d1",
    card_id: over.card_id ?? over.cards?.scryfall_id ?? id,
    quantity: over.quantity,
    cards: over.cards,
    sleeved: over.sleeved ?? 0,
    sleevedFinishes: [],
  };
}

test("designed mode uses quantity, one library element per copy", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const { library } = buildLibrary([entry({ cards: bolt, quantity: 4 })], {
    mode: "designed",
    commanderCardId: null,
  });
  assert.equal(library.length, 4);
  assert.ok(library.every((c) => c.name === "Lightning Bolt"));
});

test("built mode caps a single printing at what is sleeved", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const { library, missing } = buildLibrary(
    [entry({ cards: bolt, quantity: 4, sleeved: 3 })],
    { mode: "built", commanderCardId: null },
  );
  assert.equal(library.length, 3);
  assert.deepEqual(
    missing.map((m) => m.count),
    [1],
  );
});

test("built mode: one card under two printings does not double the sleeved total", () => {
  // Both printings of the same oracle card report the SAME sleeved total (20),
  // exactly like getDeckList's sleevedByCard — the shape that turned a
  // 100-card deck into 114 under the old deck_cards trigger (migration 20).
  const forestOldArt = card({ name: "Forest", oracle_id: "oracle-forest", scryfall_id: "forest-old" });
  const forestNewArt = card({ name: "Forest", oracle_id: "oracle-forest", scryfall_id: "forest-new" });

  const { library, missing } = buildLibrary(
    [
      entry({ cards: forestOldArt, quantity: 14, sleeved: 20 }),
      entry({ cards: forestNewArt, quantity: 6, sleeved: 20 }),
    ],
    { mode: "built", commanderCardId: null },
  );

  // 20 physically sleeved total, not 26 and not 40 — min(quantity, sleeved)
  // per entry would give 14 + 6 = 20 here by coincidence, so the real trap is
  // checked below with a shortfall on the group.
  assert.equal(library.length, 20);
  assert.equal(missing.length, 0);
});

test("built mode: the shared total is genuinely short, and the shortfall lands on the right entry", () => {
  const forestOldArt = card({ name: "Forest", oracle_id: "oracle-forest", scryfall_id: "forest-old" });
  const forestNewArt = card({ name: "Forest", oracle_id: "oracle-forest", scryfall_id: "forest-new" });

  // The list wants 14 + 6 = 20, but only 15 are actually sleeved (both
  // entries report 15 — the same oracle-keyed total). Taking
  // min(quantity, sleeved) per entry would wrongly give 14 + 6 = 20 (the
  // double-count bug). The correct spend is 14 from the first entry (in
  // order) and 1 from the second, totalling 15, with a shortfall of 5 on the
  // second entry.
  const { library, missing } = buildLibrary(
    [
      entry({ cards: forestOldArt, quantity: 14, sleeved: 15 }),
      entry({ cards: forestNewArt, quantity: 6, sleeved: 15 }),
    ],
    { mode: "built", commanderCardId: null },
  );

  assert.equal(library.length, 15);
  assert.equal(
    library.filter((c) => c.key === "oracle-forest").length,
    15,
  );
  assert.deepEqual(
    missing.map((m) => m.count),
    [5],
  );
});

test("the commander is pulled out of the library entirely", () => {
  const commanderCard = card({ name: "Atraxa, Praetors' Voice", scryfall_id: "atraxa" });
  const other = card({ name: "Sol Ring" });

  const { library, commander } = buildLibrary(
    [entry({ cards: commanderCard, quantity: 1 }), entry({ cards: other, quantity: 1 })],
    { mode: "designed", commanderCardId: "atraxa" },
  );

  assert.equal(library.length, 1);
  assert.ok(library.every((c) => c.name !== "Atraxa, Praetors' Voice"));
  assert.equal(commander?.name, "Atraxa, Praetors' Voice");
});

test("no commander named means nothing is pulled out", () => {
  const { library, commander } = buildLibrary(
    [entry({ cards: card({ name: "Sol Ring" }), quantity: 1 })],
    { mode: "designed", commanderCardId: null },
  );
  assert.equal(library.length, 1);
  assert.equal(commander, null);
});

test("an entry with no cards relation is skipped and counted, not thrown on", () => {
  const { library, skipped } = buildLibrary(
    [entry({ cards: null, quantity: 3 }), entry({ cards: card({ name: "Sol Ring" }), quantity: 1 })],
    { mode: "designed", commanderCardId: null },
  );
  assert.equal(library.length, 1);
  assert.equal(skipped, 3);
});
