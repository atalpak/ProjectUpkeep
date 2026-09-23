/**
 * Pure adapter: a deck's intended list -> a fresh `GameState` for Play mode
 * (plan section 4.4). It receives already-loaded data and never touches
 * Supabase — the caller is responsible for `getDeck()`'s ownership check and
 * for calling `getDeckList()` once, server-side.
 *
 * Always builds from the full `deck_cards` list. There is no "sleeved copies
 * only" mode here — that path was in an earlier draft of the plan and was
 * dropped 2026-09-23 (BACKLOG.md item 24's "Simplified" note): the playtester
 * never reads `DeckListEntry.sleeved` at all.
 *
 * Card object identity is derived from the `deck_cards` row id
 * (`${entry.id}:copy:{n}`) rather than a random UUID, so "same input + same
 * seed" reproduces the *exact* same `GameState`, ids included, not merely an
 * equivalent one — only the library's shuffle order depends on the seed. This
 * module borrows the `DeckListEntry` *type* from
 * `src/lib/collection/queries.ts` (type-only — erased at compile time, no
 * runtime import crosses the framework boundary), the same way
 * `src/lib/playtest/library.ts` already does.
 */

import type { DeckListEntry } from "@/lib/collection/queries";
import { mulberry32, shuffle } from "./rng";
import { emptyZones, type GameCard, type GameState } from "./board/types";

export type GameStartInput = {
  deckId: string;
  /** `locations.commander_card_id` — a specific printing, matched against
   *  `entry.card_id` exactly the way `buildLibrary` in `library.ts` does. */
  commanderCardId: string | null;
  entries: DeckListEntry[];
};

function toGameCard(id: string, entry: DeckListEntry): GameCard {
  const card = entry.cards;
  return {
    id,
    kind: "deck-card",
    cardId: card?.scryfall_id ?? null,
    oracleId: card?.oracle_id ?? null,
    name: card?.name ?? "Unknown card",
    imageUri: card?.image_uri ?? null,
    face: "front",
    tapped: false,
    rotation: 0,
    counters: {},
    note: null,
    copiedFromId: null,
    groupId: null,
    power: card?.power ?? null,
    toughness: card?.toughness ?? null,
  };
}

/** Builds the starting `GameState` for a new game. `seed` is injectable for
 *  tests and for a deliberate "same seed again" replay; a real new game omits
 *  it and gets a fresh one. */
export function createGameStart(input: GameStartInput, seed?: number): GameState {
  const usedSeed = seed ?? Math.floor(Math.random() * 0x7fffffff);
  const cards: Record<string, GameCard> = {};
  const libraryIds: string[] = [];
  let commanderId: string | null = null;

  for (const entry of input.entries) {
    // A printing deleted from `cards` after the list was built has nothing to
    // render — skip it, the same way library.ts's "built"/"designed" modes do
    // (its `skipped` count), rather than crashing the adapter.
    if (entry.cards === null) continue;

    const isCommanderEntry = input.commanderCardId !== null && entry.card_id === input.commanderCardId;

    for (let i = 0; i < entry.quantity; i++) {
      const id = `${entry.id}:copy:${i}`;
      cards[id] = toGameCard(id, entry);

      // Only the first copy becomes "the" commander object and moves to the
      // command zone. A second physical copy of a commander card (legal in a
      // few formats/partners) is an ordinary library card.
      if (isCommanderEntry && commanderId === null) {
        commanderId = id;
      } else {
        libraryIds.push(id);
      }
    }
  }

  const zones = emptyZones();
  zones.library = shuffle(libraryIds, mulberry32(usedSeed));
  if (commanderId) zones.command = [commanderId];

  return {
    schemaVersion: 1,
    deckId: input.deckId,
    seed: usedSeed,
    turn: 1,
    // 40 is the Commander default; a deck with no configured commander plays
    // at the constructed-format default of 20.
    life: commanderId ? 40 : 20,
    commanderDamage: {},
    cards,
    zones,
    log: [],
  };
}
