/**
 * Pure game-state types for the tactile solo playtester ("Play" mode).
 *
 * This folder is framework-free by convention (no React, Next.js, or
 * Supabase imports) — per the architect's 2026-09-23 impact map (BACKLOG.md
 * item 24), it lives under `src/lib/playtest/board/` rather than a new
 * `packages/playtest-core` workspace specifically so it can share
 * `src/lib/playtest/rng.ts` directly instead of duplicating the shuffle code
 * a separate package couldn't reach.
 *
 * `GameState` describes game objects and zone membership — not DOM positions
 * or React component state (plan section 4.2, `PLAYTESTER_IMPLEMENTATION_PLAN.md`).
 * One deliberate simplification versus the plan's sketch: a card's
 * battlefield group lives on the card itself (`groupId`), not in a second
 * `battlefield` array that duplicates `zones.battlefield`. The architect's
 * impact map flagged those two overlapping representations as something to
 * settle before the snapshot format is fixed in Phase 3 — this resolves it at
 * the type's birth instead of carrying a known inconsistency forward.
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

export type Face = "front" | "back" | "face-down";

/** Named counters (loyalty, +1/+1, poison, ...) on one game object. */
export type Counters = Record<string, number>;

export type GameCard = {
  /** Unique per game object — never just `cardId`. A real card that appears
   *  N times in a decklist gets N distinct objects, which is what makes
   *  shuffle and draw behave like physical cards rather than like stacked
   *  quantities. See `src/lib/playtest/game-start.ts`. */
  id: string;
  kind: "deck-card" | "token" | "copy";
  /** Scryfall id (`cards.scryfall_id`) for a real deck card; null for a token. */
  cardId: string | null;
  oracleId: string | null;
  name: string;
  imageUri: string | null;
  face: Face;
  tapped: boolean;
  rotation: 0 | 90 | 180 | 270;
  counters: Counters;
  note: string | null;
  /** Set when this object was created as a copy of another game object
   *  (the "copy" board action) — null for everything else, including tokens. */
  copiedFromId: string | null;
  /** Battlefield grouping only. Ignored by every other zone; see module
   *  header for why this replaces a separate `battlefield` array. */
  groupId: string | null;
  /** Display-only P/T, meaningful mainly for tokens (real cards' printed P/T
   *  lives on the catalog `Card` row, not in board state). Null otherwise. */
  power: string | null;
  toughness: string | null;
};

export type GameLogEntry = {
  id: string;
  turn: number;
  text: string;
};

export type GameState = {
  schemaVersion: 1;
  deckId: string;
  /** The seed the starting library was shuffled with. Reshuffles record a
   *  fresh seed on their own `SHUFFLE` command rather than mutating this. */
  seed: number;
  turn: number;
  life: number;
  /** Keyed by the *source* GameCard id (an opposing commander's object) —
   *  there is no opponent board in v1, but the shape survives one. */
  commanderDamage: Record<string, number>;
  cards: Record<string, GameCard>;
  zones: Record<ZoneId, string[]>;
  /** Bounded in `reduce.ts`; a readable history of what happened, not an
   *  undo mechanism by itself — see `board/history.ts` for that. */
  log: GameLogEntry[];
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
