/**
 * Pure game-state types for the tactile solo playtester ("Play" mode).
 *
 * This folder is framework-free (no React, Next.js, or Supabase imports) and
 * eslint.config.mjs now enforces that, along with a ban on Math.random,
 * Date.now and crypto.randomUUID: it lives under `src/lib/playtest/board/`
 * rather than a `packages/` workspace so it can share `../rng` directly.
 *
 * `GameState` describes game objects and zone membership, never DOM geometry
 * or React state. Schema version 2 (this file) replaced version 1 when the
 * board grew from a rows-and-groups shelf into a free-placement table. No
 * v1 snapshot was ever stored anywhere, so the change was free; `migrate.ts`
 * still converts one, because a pasted or test-fixture v1 blob must fail
 * safely or upgrade, never crash the board.
 *
 * Three decisions worth knowing before touching this:
 *
 *  - ONE source of truth for layout. `zones.battlefield` ORDER is both the
 *    stacking (z) order and the within-group order; there is no z field.
 *    `pos` is set only for UNGROUPED battlefield cards. A grouped card's
 *    position is derived from its group's anchor + arrangement + index
 *    (layout.ts) and never stored, so dragging a group is one write.
 *    Leaving the battlefield clears both `pos` and `groupId`.
 *
 *  - Coordinates are proportions (0..1) of a fixed-shape virtual board, not
 *    pixels, so a resize or a 200% zoom cannot move a card.
 *
 *  - Everything hidden stays in this state (library order, hand, seeds) and
 *    that is exactly why a share is never a copy of it: see share.ts.
 */

export type ZoneId =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command"
  | "sideboard"
  | "temporary";

/** Extensible on purpose: Attractions, Planechase and friends are deferred,
 *  but a new out-of-deck zone is one entry here plus its label below. */
export const ZONE_IDS: ZoneId[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "sideboard",
  "temporary",
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  library: "Library",
  hand: "Hand",
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  command: "Command zone",
  sideboard: "Sideboard",
  temporary: "Stack",
};

/** Zones whose contents are visible to everyone at a real table. */
export const PUBLIC_ZONES: readonly ZoneId[] = ["battlefield", "graveyard", "exile", "command", "temporary"];

export function isPublicZone(zone: ZoneId): boolean {
  return PUBLIC_ZONES.includes(zone);
}

/** `back` is the transformed face of a double-faced card. */
export type Face = "front" | "back" | "face-down";
export type Rotation = 0 | 90 | 180 | 270;

/** Named counters (loyalty, +1/+1, poison, ...) on one game object. */
export type Counters = Record<string, number>;

export type Pos = { x: number; y: number };

export type GameCard = {
  /** Unique per game object, never just `cardId`. A real card that appears
   *  N times in a decklist gets N distinct objects. Derived from the
   *  `deck_cards` row id (`${entry.id}:copy:n`), never a card_instances id. */
  id: string;
  /** `deck-card` came from the list; `token` and `extra` are added during
   *  play (custom or searched); `copy` is a real copy of another object. */
  kind: "deck-card" | "token" | "copy" | "extra";
  /** Scryfall id (`cards.scryfall_id`) for a real card; null for a custom one. */
  cardId: string | null;
  oracleId: string | null;
  name: string;
  typeLine: string | null;
  manaValue: number | null;
  /** True when the printing can tap for mana; drives the mana-producer metric. */
  producesMana: boolean;
  /** Small art for the table; normal art only on inspect. Never both fetched
   *  for a whole board. */
  imageSmall: string | null;
  imageNormal: string | null;
  /** Normal-size art of the back face for a double-faced card. */
  imageBack: string | null;
  face: Face;
  tapped: boolean;
  rotation: Rotation;
  /** Phased-out / dimmed visual state. A manual annotation, not a rule. */
  dimmed: boolean;
  /** Deliberately shown to the table (a reveal), independent of zone. */
  revealed: boolean;
  counters: Counters;
  note: string | null;
  copiedFromId: string | null;
  /** Battlefield grouping only; see the header. */
  groupId: string | null;
  /** Printed (or custom) power/toughness, display only. */
  power: string | null;
  toughness: string | null;
  /** Temporary P/T modifiers, kept apart from counters on purpose. */
  ptOffset: { power: number; toughness: number };
  commanderTax: number;
  /** Ungrouped battlefield cards only. Proportions of the virtual board. */
  pos: Pos | null;
};

export type GameFormat = "commander" | "constructed";

export type GameConfig = {
  format: GameFormat;
  startingLife: number;
  /** `first`: the first mulligan is free (Commander's usual house rule).
   *  Never assumed silently: the start dialog shows it. */
  freeMulligan: "none" | "first";
  /** Whether the very first turn draws (on the draw) or not (on the play). */
  firstTurnDraws: boolean;
  /** Game-object ids of the cards that start in the command zone. */
  commanderIds: string[];
};

export type ManaPool = { W: number; U: number; B: number; R: number; G: number; C: number };
export const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;
export type ManaKey = (typeof MANA_KEYS)[number];

export type Trackers = {
  life: number;
  /** A second life total (two-headed giant, a teammate, a "what if"). */
  life2: number;
  poison: number;
  experience: number;
  energy: number;
  manaPool: ManaPool;
  /** Keyed by a free label ("Atraxa"), because there is no opponent board. */
  commanderDamage: Record<string, number>;
  genericDamage: number;
};

export type GroupArrangement = "row" | "column" | "stack";
export type Group = { label: string; arrangement: GroupArrangement; anchor: Pos };

export type EventKind =
  | "start"
  | "draw"
  | "mill"
  | "move"
  | "flags"
  | "counter"
  | "proliferate"
  | "create"
  | "delete"
  | "shuffle"
  | "mulligan"
  | "keep"
  | "peek"
  | "reveal"
  | "tracker"
  | "turn"
  | "roll"
  | "layout"
  | "group"
  | "note"
  | "reorder"
  | "discard"
  | "interaction"
  | "simulator"
  | "restore";

export type EventData = Record<string, string | number | boolean | null>;

/** Structured on purpose: display text is derived (`describeEvent`), never
 *  stored, so metrics can be recomputed and the wording can change. */
export type GameEvent = {
  seq: number;
  /** Events from one user gesture share this (the seq of the gesture's first
   *  event), which is what makes multi-card actions one log line. */
  gestureId: number;
  turn: number;
  /** Set by the browser store when a command is sent; 0 in tests. */
  ts: number;
  kind: EventKind;
  ids: string[];
  names: string[];
  from: ZoneId | null;
  to: ZoneId | null;
  data: EventData;
  /** Corrected/removed by the player without touching the board. */
  voided: boolean;
  /** Never leaves the owner's browser (peeks, searches, notes). */
  private: boolean;
};

export type OpeningState = {
  status: "deciding" | "kept";
  /** Mulligans taken so far, free or paid. */
  mulligans: number;
};

/* ------------------------------------------------------------------ */
/* Opponent-interaction prompt generator state (pure; see opponent/).  */
/* ------------------------------------------------------------------ */

export const INTERACTION_CATEGORIES = [
  "counterspell",
  "spotRemoval",
  "massRemoval",
  "attack",
  "stax",
  "discard",
] as const;
export type InteractionCategory = (typeof INTERACTION_CATEGORIES)[number];
export type ChanceLevel = "off" | "low" | "medium" | "high";

export type SimulatorSettings = {
  enabled: boolean;
  firstTurn: number;
  /** 1 to 3 prompts per turn. */
  maxPerTurn: number;
  chances: Record<InteractionCategory, ChanceLevel>;
  /** Odds that a turn brings no interaction at all, as a level. */
  nothing: ChanceLevel;
  millOpponent: boolean;
  gameChangers: boolean;
  preset: string;
};

export type InteractionResolution = "pending" | "ignored" | "resolved" | "rerolled";

export type InteractionResult = {
  turn: number;
  rerollIndex: number;
  /** Categories generated; empty is a valid "no interaction". */
  prompts: InteractionCategory[];
  resolution: InteractionResolution;
  reason: string | null;
};

export type SimulatorState = {
  settings: SimulatorSettings;
  /** Private: seed + settings + turn regenerates every prompt. */
  seed: number;
  results: InteractionResult[];
};

export type GameState = {
  schemaVersion: 2;
  deckId: string;
  source: { fingerprint: string; deckSize: number };
  /** Private. The seed the starting library was shuffled with. */
  seed: number;
  config: GameConfig;
  opening: OpeningState;
  turn: number;
  trackers: Trackers;
  cards: Record<string, GameCard>;
  zones: Record<ZoneId, string[]>;
  groups: Record<string, Group>;
  events: GameEvent[];
  nextEventSeq: number;
  /** Set when old events were dropped to fit the save cap, so charts can say
   *  their data is partial. */
  eventsTruncatedBefore: number | null;
  simulator: SimulatorState;
};

export function emptyZones(): Record<ZoneId, string[]> {
  return {
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    sideboard: [],
    temporary: [],
  };
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function initialTrackers(life: number): Trackers {
  return {
    life,
    life2: life,
    poison: 0,
    experience: 0,
    energy: 0,
    manaPool: emptyManaPool(),
    commanderDamage: {},
    genericDamage: 0,
  };
}

export function defaultSimulatorSettings(): SimulatorSettings {
  return {
    enabled: false,
    firstTurn: 3,
    maxPerTurn: 1,
    chances: {
      counterspell: "low",
      spotRemoval: "medium",
      massRemoval: "low",
      attack: "medium",
      stax: "low",
      discard: "low",
    },
    nothing: "medium",
    millOpponent: false,
    gameChangers: false,
    preset: "balanced",
  };
}

/** Limits shared by the reducer, the validator and the share projection. */
export const LIMITS = {
  name: 200,
  note: 1000,
  imageUrl: 500,
  counterName: 40,
  counterValue: 9999,
  tracker: 9999,
  groupLabel: 60,
  events: 1000,
  cards: 1500,
} as const;
