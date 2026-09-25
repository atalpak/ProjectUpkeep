/**
 * Hand-built starting states for the reducer, selector, serializer and
 * undo/redo tests, so none of them needs a real deck. `board/` deliberately has
 * no runtime dependency on `src/lib/collection`, so these are built from the
 * board's own types; `game-start.ts`'s tests build their own `DeckListEntry`
 * fixtures for the adapter.
 *
 * All fixtures start at turn 0 with the opening already KEPT and an empty hand
 * (so a test can issue commands directly); `fixtureOpeningHand()` is the
 * exception, dealt and still deciding, for the mulligan tests.
 */

import { relocate } from "./reducers/zones";
import { defaultConfig } from "./format";
import { defaultSimulatorSettings, emptyZones, initialTrackers, type GameCard, type GameConfig, type GameState } from "./types";

export const FIXTURE_FINGERPRINT = "0".repeat(64);

export function makeGameCard(id: string, name: string, over: Partial<GameCard> = {}): GameCard {
  return {
    id,
    kind: "deck-card",
    cardId: `scryfall-${id}`,
    oracleId: `oracle-${id}`,
    name,
    typeLine: null,
    manaValue: null,
    producesMana: false,
    imageSmall: null,
    imageNormal: null,
    imageBack: null,
    face: "front",
    tapped: false,
    rotation: 0,
    dimmed: false,
    revealed: false,
    counters: {},
    note: null,
    copiedFromId: null,
    groupId: null,
    power: null,
    toughness: null,
    ptOffset: { power: 0, toughness: 0 },
    commanderTax: 0,
    pos: null,
    ...over,
  };
}

export function makeState(cards: GameCard[], zones: Partial<Record<keyof ReturnType<typeof emptyZones>, string[]>>, config: Partial<GameConfig> = {}): GameState {
  const table: Record<string, GameCard> = {};
  for (const card of cards) table[card.id] = card;
  const full = { ...emptyZones(), ...zones };
  const merged: GameConfig = { ...defaultConfig("constructed"), ...config };
  return {
    schemaVersion: 2,
    deckId: "fixture-deck",
    source: { fingerprint: FIXTURE_FINGERPRINT, deckSize: cards.length },
    seed: 12345,
    config: merged,
    opening: { status: "kept", mulligans: 0 },
    turn: 0,
    trackers: initialTrackers(merged.startingLife),
    cards: table,
    zones: full,
    groups: {},
    events: [],
    nextEventSeq: 0,
    eventsTruncatedBefore: null,
    simulator: { settings: defaultSimulatorSettings(), seed: 4242, results: [] },
  };
}

/** A generic 60-card starting library, no commander. Deliberately not
 *  pre-shuffled: `card-0` is on top, which makes DRAW/SHUFFLE assertions easy. */
export function fixtureSixtyCardStart(): GameState {
  const cards: GameCard[] = [];
  for (let i = 0; i < 60; i++) cards.push(makeGameCard(`card-${i}`, `Test Card ${i}`));
  return makeState(cards, { library: cards.map((c) => c.id) });
}

/** A 100-card Commander start: 99 library cards plus the commander already in
 *  the command zone, the shape `game-start.ts` produces. */
export function fixtureCommanderStart(): GameState {
  const cards: GameCard[] = [];
  for (let i = 0; i < 99; i++) cards.push(makeGameCard(`card-${i}`, `Test Card ${i}`));
  const commander = makeGameCard("commander-0", "Test Commander", { typeLine: "Legendary Creature", power: "3", toughness: "3" });
  return makeState(
    [...cards, commander],
    { library: cards.map((c) => c.id), command: [commander.id] },
    { ...defaultConfig("commander"), commanderIds: [commander.id] },
  );
}

/** The 60-card start, dealt seven and still deciding (mulligans available). */
export function fixtureOpeningHand(config: Partial<GameConfig> = {}): GameState {
  const base = fixtureSixtyCardStart();
  const deciding: GameState = { ...base, config: { ...base.config, ...config }, opening: { status: "deciding", mulligans: 0 } };
  // Dealt the way game-start.ts deals: no "draw" event, it is setup.
  const dealt = relocate(deciding, deciding.zones.library.slice(0, 7), "hand", { at: "bottom" });
  return dealt ? dealt.state : deciding;
}
