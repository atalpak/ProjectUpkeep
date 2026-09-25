/**
 * createGameStart: the adapter from a deck's intended list to a fresh, dealt
 * GameState. Builds its own minimal DeckListEntry fixtures rather than
 * depending on board/fixtures.ts, because board/ deliberately has no
 * dependency on src/lib/collection.
 *
 * Run with: npx tsx --test scripts/playtest-game-start.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createGameStart, commanderProblems, type GameStartInput } from "../src/lib/playtest/game-start";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import type { DeckListEntry } from "../src/lib/collection/queries";
import type { Card } from "../src/lib/types";

let seq = 0;
const FP = "a".repeat(64);

function card(over: Partial<Card> & { name: string }): Card {
  const id = over.scryfall_id ?? `scryfall-${++seq}`;
  return {
    scryfall_id: id,
    oracle_id: over.oracle_id ?? `oracle-${over.name}`,
    name: over.name,
    image_uri: over.image_uri ?? null,
    image_uri_small: over.image_uri_small ?? null,
    type_line: over.type_line ?? null,
    cmc: over.cmc ?? null,
    produced_mana: over.produced_mana ?? null,
    card_faces: over.card_faces ?? null,
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

function input(entries: DeckListEntry[], over: Partial<GameStartInput> = {}): GameStartInput {
  return { deckId: "deck-1", fingerprint: FP, entries, commanderCardIds: [], format: "constructed", ...over };
}

function forestDeck(count: number): DeckListEntry[] {
  return [entry({ cards: card({ name: "Forest", type_line: "Basic Land — Forest" }), quantity: count })];
}

test("one unique game object per listed copy", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const state = createGameStart(input([entry({ cards: bolt, quantity: 4 })]), 1);
  const objects = Object.values(state.cards);
  assert.equal(objects.length, 4);
  assert.equal(new Set(objects.map((o) => o.id)).size, 4, "each copy must get a distinct game object id");
  assert.ok(objects.every((o) => o.name === "Lightning Bolt"));
  assert.equal(state.zones.library.length + state.zones.hand.length, 4);
  assert.deepEqual(checkInvariants(state), []);
});

test("duplicate printings of one card stay distinct objects with their own ids", () => {
  const a = card({ name: "Sol Ring", scryfall_id: "sol-a" });
  const b = card({ name: "Sol Ring", scryfall_id: "sol-b" });
  const state = createGameStart(input([entry({ cards: a, quantity: 1 }), entry({ cards: b, quantity: 1 })]), 3);
  assert.equal(Object.keys(state.cards).length, 2);
  assert.deepEqual(new Set(Object.values(state.cards).map((c) => c.cardId)), new Set(["sol-a", "sol-b"]));
});

test("the game starts at turn 0 with seven cards in hand and the keep decision pending", () => {
  const state = createGameStart(input(forestDeck(60)), 7);
  assert.equal(state.turn, 0);
  assert.equal(state.zones.hand.length, 7);
  assert.equal(state.zones.library.length, 53);
  assert.deepEqual(state.opening, { status: "deciding", mulligans: 0 });
  assert.equal(state.events.length, 1, "only the start event: dealing the opener is not a play");
});

test("a library smaller than seven deals what it has instead of crashing", () => {
  const state = createGameStart(input(forestDeck(3)), 7);
  assert.equal(state.zones.hand.length, 3);
  assert.equal(state.zones.library.length, 0);
  assert.deepEqual(checkInvariants(state), []);
});

test("the configured commander is moved to the command zone and excluded from the library", () => {
  const commanderCard = card({ name: "Atraxa, Praetors' Voice" });
  const commanderEntry = entry({ cards: commanderCard, quantity: 1 });
  const state = createGameStart(input([commanderEntry, ...forestDeck(99)], { format: "commander", commanderCardIds: [commanderCard.scryfall_id] }), 5);
  assert.equal(state.zones.command.length, 1);
  assert.equal(state.cards[state.zones.command[0]].name, "Atraxa, Praetors' Voice");
  assert.equal(state.zones.library.length + state.zones.hand.length, 99);
  assert.deepEqual(state.config.commanderIds, state.zones.command);
});

test("partner commanders both start outside the library", () => {
  const a = card({ name: "Thrasios" });
  const b = card({ name: "Tymna" });
  const state = createGameStart(
    input([entry({ cards: a, quantity: 1 }), entry({ cards: b, quantity: 1 }), ...forestDeck(98)], { format: "commander", commanderCardIds: [a.scryfall_id, b.scryfall_id] }),
    5,
  );
  assert.deepEqual(state.zones.command.map((id) => state.cards[id].name).sort(), ["Thrasios", "Tymna"]);
  assert.equal(state.zones.library.length + state.zones.hand.length, 98);
  assert.ok(![...state.zones.library, ...state.zones.hand].some((id) => state.cards[id].name === "Thrasios" || state.cards[id].name === "Tymna"));
});

test("a second copy of a commander card is an ordinary library card", () => {
  const c = card({ name: "Relentless Rats" });
  const state = createGameStart(input([entry({ cards: c, quantity: 2 })], { format: "commander", commanderCardIds: [c.scryfall_id] }), 1);
  assert.equal(state.zones.command.length, 1);
  assert.equal(state.zones.library.length + state.zones.hand.length, 1);
});

test("full-decklist generation matches the deck list across duplicate quantities", () => {
  const bolt = card({ name: "Lightning Bolt" });
  const island = card({ name: "Island" });
  const state = createGameStart(input([entry({ cards: bolt, quantity: 4 }), entry({ cards: island, quantity: 20 })]), 9);
  const counts = new Map<string, number>();
  for (const c of Object.values(state.cards)) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  assert.equal(counts.get("Lightning Bolt"), 4);
  assert.equal(counts.get("Island"), 20);
});

test("a deleted printing (null cards relation) is skipped rather than crashing the adapter", () => {
  const island = card({ name: "Island" });
  const state = createGameStart(input([entry({ cards: null, quantity: 3 }), entry({ cards: island, quantity: 2 })]), 1);
  assert.equal(Object.keys(state.cards).length, 2);
});

test("life follows the chosen format and can be overridden", () => {
  assert.equal(createGameStart(input(forestDeck(20)), 1).trackers.life, 20);
  assert.equal(createGameStart(input(forestDeck(20), { format: "commander" }), 1).trackers.life, 40);
  assert.equal(createGameStart(input(forestDeck(20), { startingLife: 30 }), 1).trackers.life, 30);
});

test("card display fields come from the catalog row: small art for the table, normal for inspect", () => {
  const c = card({
    name: "Delver of Secrets",
    image_uri: "https://cards.scryfall.io/normal/x.jpg",
    image_uri_small: "https://cards.scryfall.io/small/x.jpg",
    type_line: "Creature — Human Wizard",
    cmc: 1,
    card_faces: [{}, { image_uris: { normal: "https://cards.scryfall.io/normal/back.jpg" } }] as never,
  });
  const state = createGameStart(input([entry({ cards: c, quantity: 1 })]), 1);
  const obj = Object.values(state.cards)[0];
  assert.equal(obj.imageSmall, "https://cards.scryfall.io/small/x.jpg");
  assert.equal(obj.imageNormal, "https://cards.scryfall.io/normal/x.jpg");
  assert.equal(obj.imageBack, "https://cards.scryfall.io/normal/back.jpg");
  assert.equal(obj.manaValue, 1);
});

test("exit criterion: identical seed + identical entries yields identical state, ids included", () => {
  const entries = [entry({ id: "e1", cards: card({ name: "A", scryfall_id: "a" }), quantity: 30 }), entry({ id: "e2", cards: card({ name: "B", scryfall_id: "b" }), quantity: 30 })];
  assert.deepEqual(createGameStart(input(entries), 424242), createGameStart(input(entries), 424242));
});

test("different seeds over the same input produce a different library order", () => {
  const entries = [entry({ id: "e1", cards: card({ name: "A", scryfall_id: "a" }), quantity: 60 })];
  assert.notDeepEqual(createGameStart(input(entries), 1).zones.library, createGameStart(input(entries), 2).zones.library);
});

test("the fingerprint is carried through and the simulator seed is derived, not shared with the shuffle", () => {
  const state = createGameStart(input(forestDeck(10)), 100);
  assert.equal(state.source.fingerprint, FP);
  assert.notEqual(state.simulator.seed, state.seed);
});

test("commanderProblems names a commander that is not in the list", () => {
  const forest = forestDeck(1);
  assert.deepEqual(commanderProblems({ entries: forest, commanderCardIds: [forest[0].card_id] }), []);
  assert.equal(commanderProblems({ entries: forest, commanderCardIds: ["ghost"] }).length, 1);
});
