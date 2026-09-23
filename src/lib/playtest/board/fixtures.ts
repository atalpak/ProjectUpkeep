/**
 * Small, hand-built starting states for exercising the reducer, selectors,
 * serializer and undo/redo without needing a real deck. `board/` deliberately
 * has no dependency on `src/lib/collection` (see `types.ts`'s header), so
 * these are constructed directly from the board's own types rather than
 * through the web adapter — `game-start.ts`'s own tests build their own
 * `DeckListEntry`-shaped fixtures for exercising that adapter specifically.
 */

import { emptyZones, type GameCard, type GameState } from "./types";

function makeCard(id: string, name: string): GameCard {
  return {
    id,
    kind: "deck-card",
    cardId: `scryfall-${id}`,
    oracleId: `oracle-${id}`,
    name,
    imageUri: null,
    face: "front",
    tapped: false,
    rotation: 0,
    counters: {},
    note: null,
    copiedFromId: null,
    groupId: null,
    power: null,
    toughness: null,
  };
}

/** A generic 60-card starting library, no commander. Deliberately not
 *  pre-shuffled — the fixture's stable order (`card-0` on top) is itself
 *  useful for assertions about `DRAW`/`SHUFFLE`, and a caller wanting a
 *  shuffled start can apply that command like any other. */
export function fixtureSixtyCardStart(): GameState {
  const cards: Record<string, GameCard> = {};
  const library: string[] = [];
  for (let i = 0; i < 60; i++) {
    const id = `card-${i}`;
    cards[id] = makeCard(id, `Test Card ${i}`);
    library.push(id);
  }
  const zones = emptyZones();
  zones.library = library;
  return {
    schemaVersion: 1,
    deckId: "fixture-deck-60",
    seed: 12345,
    turn: 1,
    life: 20,
    commanderDamage: {},
    cards,
    zones,
    log: [],
  };
}

/** A 100-card Commander starting state: 99 library cards plus one commander
 *  already in the command zone — the shape `game-start.ts` produces for a
 *  deck with `commander_card_id` set. */
export function fixtureCommanderStart(): GameState {
  const cards: Record<string, GameCard> = {};
  const library: string[] = [];
  for (let i = 0; i < 99; i++) {
    const id = `card-${i}`;
    cards[id] = makeCard(id, `Test Card ${i}`);
    library.push(id);
  }
  const commanderId = "commander-0";
  cards[commanderId] = makeCard(commanderId, "Test Commander");
  const zones = emptyZones();
  zones.library = library;
  zones.command = [commanderId];
  return {
    schemaVersion: 1,
    deckId: "fixture-deck-commander",
    seed: 67890,
    turn: 1,
    life: 40,
    commanderDamage: {},
    cards,
    zones,
    log: [],
  };
}
