/**
 * The discriminated command union that fully describes a change to
 * `GameState` (plan section 4.3). The UI never mutates state directly — every
 * action, from drawing a card to restoring a saved snapshot, is one of these,
 * applied through `reduce.ts`'s `applyCommand`.
 *
 * Anything a command needs that would otherwise be generated randomly at
 * apply-time (a token's object ids, a reshuffle's seed) is carried on the
 * command itself instead. That is what keeps "same start input + seed +
 * command sequence always yields the same state" (this phase's exit
 * criterion) true regardless of when or how many times a command is replayed.
 *
 * `SET_NOTE` and `SET_ROTATION` were added in Phase 2 (the desktop tabletop),
 * not Phase 1 — the plan's own `GameCard.note`/`rotation` fields existed from
 * the start (types.ts) but Phase 1 never wired a command to either, since
 * nothing needed to set one until the battlefield's card menu (section 3.3's
 * "notes" and "rotate" requirements) did. Both follow the exact same shape as
 * every other single-field setter here (`SET_TAPPED`, `SET_FACE`) rather than
 * inventing a different pattern.
 */

import type { Face, GameState, ZoneId } from "./types";

export type TokenSpec = {
  name: string;
  power: string | null;
  toughness: string | null;
  imageUri: string | null;
};

export type GameCommand =
  | { type: "DRAW"; count: number }
  | { type: "MOVE_CARD"; cardId: string; to: ZoneId; index: number | null; groupId?: string | null }
  | { type: "SET_TAPPED"; cardId: string; tapped: boolean }
  | { type: "SET_FACE"; cardId: string; face: Face }
  | { type: "SET_NOTE"; cardId: string; note: string | null }
  | { type: "SET_ROTATION"; cardId: string; rotation: 0 | 90 | 180 | 270 }
  | { type: "ADD_COUNTER"; cardId: string; name: string; delta: number }
  | { type: "CREATE_TOKEN"; ids: string[]; token: TokenSpec; zone: ZoneId }
  | { type: "DELETE_OBJECT"; cardId: string }
  | { type: "SHUFFLE"; zone: ZoneId; seed: number }
  | { type: "SET_LIFE"; delta: number }
  | { type: "NEXT_TURN" }
  | { type: "RESTORE_SNAPSHOT"; snapshot: GameState };
