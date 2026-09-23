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
  | { type: "ADD_COUNTER"; cardId: string; name: string; delta: number }
  | { type: "CREATE_TOKEN"; ids: string[]; token: TokenSpec; zone: ZoneId }
  | { type: "DELETE_OBJECT"; cardId: string }
  | { type: "SHUFFLE"; zone: ZoneId; seed: number }
  | { type: "SET_LIFE"; delta: number }
  | { type: "NEXT_TURN" }
  | { type: "RESTORE_SNAPSHOT"; snapshot: GameState };
