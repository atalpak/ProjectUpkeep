/**
 * createGameStart: the web adapter from a deck's intended list to a fresh
 * GameState. Builds its own minimal DeckListEntry fixtures the same way
 * playtest-library.test.ts does for buildLibrary, rather than depending on
 * board/fixtures.ts — board/ deliberately has no dependency on
 * src/lib/collection, see board/fixtures.ts's header.
 *
 * Run with: npx tsx --test scripts/playtest-game-start.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createGameStart } from "../src/lib/playtest/game-start";
import type { DeckListEntry } from "../src/lib/collection/queries";
import type { Card } from "../src/lib/types";

let seq = 0;

function card(over: Partial<Card> & { name: string }): Card {
  const id = over.scryfall_id ?? `scryfall-${++seq}`;
  return {
    scryfall_id: id,
    oracle_id: over.oracle_id ?? `oracle-${over.name}`,
    name: over.name,
    image_uri: over.image_uri ?? null,
    power: over.power ?? null,
    toughness: over.toughness ?? null,
  } as unknown as Card;
}

function entry(over: { id?: string; card_id?: string; quantity: number; cards: Card | null }): DeckListEntry {
  const id = over.id ?? `entry-${++seq}`;
  return {
    id,
    deck_id: "deck-1",
    card_id: over.card_id ?? over.cards?.scryfall_id ?? id,
    quantity: over.quantity,
    cards: over.cards,
    sleeved: 0,
    sleevedFinishes: [],
  };
}

test("one unique game object per listed copy", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const state = createGameStart({ deckId: "deck-1", commanderCardId: null, entries: [entry({ cards: bolt, quantity: 4 })] }, 1);

  const objects = Object.values(state.cards);
  assert.equal(objects.length, 4);
  const ids = new Set(objects.map((o) => o.id));
  assert.equal(ids.size, 4, "each copy must get a distinct game object id");
  assert.ok(objects.every((o) => o.name === "Lightning Bolt"));
  assert.equal(state.zones.library.length, 4);
});

test("the configured commander is moved to the command zone and excluded from the library", () => {
  const commanderCard = card({ name: "Atraxa, Praetors' Voice" });
  const forest = card({ name: "Forest" });
  const commanderEntry = entry({ cards: commanderCard, quantity: 1 });
  const forestEntry = entry({ cards: forest, quantity: 10 });

  const state = createGameStart(
    {
      deckId: "deck-1",
      commanderCardId: commanderEntry.card_id,
      entries: [commanderEntry, forestEntry],
    },
    1,
  );

  assert.equal(state.zones.command.length, 1);
  assert.equal(state.cards[state.zones.command[0]].name, "Atraxa, Praetors' Voice");
  assert.equal(state.zones.library.length, 10);
  assert.ok(!state.zones.library.includes(state.zones.command[0]));
  assert.ok(state.zones.library.every((id) => state.cards[id].name === "Forest"));
});

test("full-decklist generation matches the deck list across duplicate quantities and commander removal", () => {
  const commanderCard = card({ name: "Commander Card" });
  const bolt = card({ name: "Lightning Bolt" });
  const island = card({ name: "Island" });
  const commanderEntry = entry({ cards: commanderCard, quantity: 1 });
  const boltEntry = entry({ cards: bolt, quantity: 4 });
  const islandEntry = entry({ cards: island, quantity: 17 });

  const state = createGameStart(
    {
      deckId: "deck-1",
      commanderCardId: commanderEntry.card_id,
      entries: [commanderEntry, boltEntry, islandEntry],
    },
    1,
  );

  // Total objects: every listed copy, commander included.
  assert.equal(Object.keys(state.cards).length, 1 + 4 + 17);
  // Library excludes just the one commander copy.
  assert.equal(state.zones.library.length, 4 + 17);
  const nameCounts = new Map<string, number>();
  for (const id of state.zones.library) {
    const name = state.cards[id].name;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  assert.equal(nameCounts.get("Lightning Bolt"), 4);
  assert.equal(nameCounts.get("Island"), 17);
  assert.equal(nameCounts.has("Commander Card"), false);
});

test("a deleted printing (null cards relation) is skipped rather than crashing the adapter", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const state = createGameStart(
    {
      deckId: "deck-1",
      commanderCardId: null,
      entries: [entry({ cards: bolt, quantity: 2 }), entry({ cards: null, quantity: 3 })],
    },
    1,
  );
  assert.equal(state.zones.library.length, 2);
});

test("no commander configured: the whole list goes into the library and life starts at 20", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const state = createGameStart({ deckId: "deck-1", commanderCardId: null, entries: [entry({ cards: bolt, quantity: 60 })] }, 1);
  assert.equal(state.zones.library.length, 60);
  assert.equal(state.zones.command.length, 0);
  assert.equal(state.life, 20);
});

test("a commander deck starts at 40 life", () => {
  const commanderCard = card({ name: "Commander Card" });
  const commanderEntry = entry({ cards: commanderCard, quantity: 1 });
  const state = createGameStart({ deckId: "deck-1", commanderCardId: commanderEntry.card_id, entries: [commanderEntry] }, 1);
  assert.equal(state.life, 40);
});

test("exit criterion: identical seed + identical entries yields identical library order and game state", () => {
  const bolt = card({ name: "Lightning Bolt", scryfall_id: "bolt-1" });
  const island = card({ name: "Island", scryfall_id: "island-1" });
  const entries: DeckListEntry[] = [
    entry({ id: "e1", cards: bolt, quantity: 4 }),
    entry({ id: "e2", cards: island, quantity: 17 }),
  ];

  const a = createGameStart({ deckId: "deck-1", commanderCardId: null, entries }, 42);
  const b = createGameStart({ deckId: "deck-1", commanderCardId: null, entries }, 42);

  assert.deepEqual(a, b);
  assert.deepEqual(a.zones.library, b.zones.library);
});

test("different seeds over the same input produce a different library order", () => {
  const bolt = card({ name: "Lightning Bolt", scryfall_id: "bolt-1" });
  const entries: DeckListEntry[] = [entry({ id: "e1", cards: bolt, quantity: 40 })];

  const a = createGameStart({ deckId: "deck-1", commanderCardId: null, entries }, 1);
  const b = createGameStart({ deckId: "deck-1", commanderCardId: null, entries }, 2);

  // Same card ids exist in both (identity is derived from the entry, not the
  // seed) but the shuffle order differs.
  assert.deepEqual([...a.zones.library].sort(), [...b.zones.library].sort());
  assert.notDeepEqual(a.zones.library, b.zones.library);
});

test("omitting a seed still produces a usable, internally consistent state", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const state = createGameStart({ deckId: "deck-1", commanderCardId: null, entries: [entry({ cards: bolt, quantity: 10 })] });
  assert.equal(state.zones.library.length, 10);
  assert.equal(typeof state.seed, "number");
});
