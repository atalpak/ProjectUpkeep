/**
 * Pure adapter: a deck's intended list -> a fresh, DEALT `GameState` for Play
 * mode. It receives already-loaded data and never touches Supabase or the
 * clock; the caller (the browser store) supplies the seed, so "same input +
 * same seed" reproduces the exact same state, ids and library order included.
 *
 * Always builds from the full `deck_cards` list. There is no "sleeved copies
 * only" mode: the playtester never reads `DeckListEntry.sleeved`.
 *
 * Card object identity comes from the `deck_cards` row id
 * (`${entry.id}:copy:{n}`), never a `card_instances` id and never a random
 * UUID, so a game object cannot be confused with a physical copy and replay is
 * exact. This module borrows the `DeckListEntry` *type* from
 * `src/lib/collection/queries.ts` (type-only, erased at compile time; lint
 * allows exactly that and nothing more).
 *
 * Commanders (one, or two for partners) are named by PRINTING id and each
 * matches the first copy of its list entry. They start in the command zone,
 * outside the library, whatever the deck size; a second physical copy of the
 * same card stays an ordinary library card. The game then starts at turn 0
 * with the opening seven already drawn and the keep/mulligan decision pending.
 */

import type { StartEntry } from "./slim";
import { defaultConfig } from "./board/format";
import { OPENING_HAND_SIZE, relocate } from "./board/reducers/zones";
import { mulberry32, shuffle } from "./rng";
import {
  defaultSimulatorSettings,
  emptyZones,
  initialTrackers,
  LIMITS,
  type GameCard,
  type GameConfig,
  type GameFormat,
  type GameState,
} from "./board/types";

export type GameStartInput = {
  deckId: string;
  /** Hex digest computed on the server from `fingerprintText` (fingerprint.ts). */
  fingerprint: string;
  entries: StartEntry[];
  /** Printings (`cards.scryfall_id`) that start in the command zone. */
  commanderCardIds: string[];
  format: GameFormat;
  startingLife?: number;
  freeMulligan?: GameConfig["freeMulligan"];
  firstTurnDraws?: boolean;
};

function toGameCard(id: string, entry: StartEntry): GameCard {
  const card = entry.cards;
  const typeLine = card?.type_line ?? null;
  return {
    id,
    kind: "deck-card",
    cardId: card?.scryfall_id ?? null,
    oracleId: card?.oracle_id ?? null,
    name: (card?.name ?? "Unknown card").slice(0, LIMITS.name),
    typeLine,
    manaValue: card?.cmc ?? null,
    producesMana: (card?.produced_mana?.length ?? 0) > 0 || /\bBasic Land\b/.test(typeLine ?? ""),
    imageSmall: card?.image_uri_small ?? null,
    imageNormal: card?.image_uri ?? null,
    imageBack: card?.card_faces?.[1]?.image_uris?.normal ?? null,
    face: "front",
    tapped: false,
    rotation: 0,
    dimmed: false,
    revealed: false,
    counters: {},
    note: null,
    copiedFromId: null,
    groupId: null,
    power: card?.power ?? null,
    toughness: card?.toughness ?? null,
    ptOffset: { power: 0, toughness: 0 },
    commanderTax: 0,
    pos: null,
  };
}

/** Distinct entries in `input` that name an unusable commander, for the start
 *  dialog to explain rather than silently ignore. */
export function commanderProblems(input: Pick<GameStartInput, "entries" | "commanderCardIds">): string[] {
  const listed = new Set(input.entries.map((e) => e.card_id));
  return input.commanderCardIds.filter((id) => !listed.has(id)).map((id) => `Commander ${id} is not in the decklist.`);
}

/** Builds the dealt starting state. `seed` shuffles the library; the
 *  simulator gets its own derived seed so a prompt sequence never depends on
 *  how many times the library was shuffled. */
export function createGameStart(input: GameStartInput, seed: number): GameState {
  const cards: Record<string, GameCard> = {};
  const libraryIds: string[] = [];
  const commanderIds: string[] = [];
  const pending = new Set(input.commanderCardIds);

  for (const entry of input.entries) {
    // A printing deleted from `cards` after the list was built has nothing to
    // render; skip it rather than crash the adapter.
    if (entry.cards === null) continue;

    for (let i = 0; i < entry.quantity; i++) {
      const id = `${entry.id}:copy:${i}`;
      cards[id] = toGameCard(id, entry);
      if (pending.has(entry.card_id)) {
        pending.delete(entry.card_id);
        commanderIds.push(id);
      } else {
        libraryIds.push(id);
      }
    }
  }

  const base = defaultConfig(input.format);
  const config: GameConfig = {
    ...base,
    startingLife: input.startingLife ?? base.startingLife,
    freeMulligan: input.freeMulligan ?? base.freeMulligan,
    firstTurnDraws: input.firstTurnDraws ?? base.firstTurnDraws,
    commanderIds,
  };

  const zones = emptyZones();
  zones.library = shuffle(libraryIds, mulberry32(seed));
  zones.command = commanderIds;

  const empty: GameState = {
    schemaVersion: 2,
    deckId: input.deckId,
    source: { fingerprint: input.fingerprint, deckSize: Object.keys(cards).length },
    seed,
    config,
    opening: { status: "deciding", mulligans: 0 },
    turn: 0,
    trackers: initialTrackers(config.startingLife),
    cards,
    zones,
    groups: {},
    events: [],
    nextEventSeq: 0,
    eventsTruncatedBefore: null,
    simulator: { settings: defaultSimulatorSettings(), seed: (seed ^ 0x9e3779b9) >>> 0, results: [] },
  };

  const started = {
    ...empty,
    events: [
      {
        seq: 0,
        gestureId: 0,
        turn: 0,
        ts: 0,
        kind: "start" as const,
        ids: [],
        names: [],
        from: null,
        to: null,
        data: { format: config.format },
        voided: false,
        private: false,
      },
    ],
    nextEventSeq: 1,
  };
  // The opening deal is part of setup, not a play: it moves the cards without
  // logging a "draw", so a freshly dealt game is not "dirty" (no restart
  // confirmation) and the log's first line after Start is the player's own.
  const dealt = relocate(started, zones.library.slice(0, OPENING_HAND_SIZE), "hand", { at: "bottom" });
  return dealt ? dealt.state : started;
}
