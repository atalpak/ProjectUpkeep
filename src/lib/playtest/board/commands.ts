/**
 * The discriminated command union that fully describes a change to
 * `GameState`. The UI never mutates state directly: every action, from a draw
 * to a restored save, is one of these applied through `reduce.ts`.
 *
 * Two rules keep "same seed + same commands = same state" true:
 *
 *  - Anything random is decided BEFORE the command and carried on it. A
 *    reshuffle carries its seed, a token carries its object ids, a random
 *    discard carries the chosen card, a die roll carries its result, and an
 *    opponent-interaction prompt carries the prompts already generated. The
 *    reducer itself has no source of randomness (and lint bans one).
 *  - One user gesture is one command. A multi-card action is a single
 *    `MOVE_MANY` or a `BATCH`, so the store records exactly one undo step and
 *    the log shows one line. That is why Mulligan, Next turn and Keep are
 *    commands of their own rather than sequences the UI stitches together.
 *
 * `CREATE_EXTRA` replaced the v1 `CREATE_TOKEN`; the London mulligan flow that
 * used to live in PlayBoard now lives here (`MULLIGAN` / `KEEP`).
 */

import type {
  Face,
  GameState,
  InteractionCategory,
  InteractionResolution,
  Pos,
  Rotation,
  SimulatorSettings,
  ZoneId,
  GroupArrangement,
} from "./types";

/** What a new object looks like. `imageBack` is the transformed face. */
export type ExtraSpec = {
  name: string;
  typeLine?: string | null;
  power: string | null;
  toughness: string | null;
  manaValue?: number | null;
  imageSmall: string | null;
  imageNormal: string | null;
  imageBack?: string | null;
  cardId?: string | null;
  oracleId?: string | null;
  producesMana?: boolean;
  /** Present for a copy: the printed counters and state are NOT copied. */
  note?: string | null;
};

export type CardFlags = Partial<{
  tapped: boolean;
  face: Face;
  rotation: Rotation;
  dimmed: boolean;
  ptOffset: { power: number; toughness: number };
  commanderTax: number;
}>;

export type Placement = { id: string; x: number; y: number };

export type InsertAt = "top" | "bottom" | number;

export type DiceKind = "coin" | "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

export type GameCommand =
  | { type: "DRAW"; count: number }
  | { type: "MILL"; count: number }
  | { type: "MOVE_CARD"; cardId: string; to: ZoneId; index: number | null; groupId?: string | null; pos?: Pos | null }
  | {
      type: "MOVE_MANY";
      ids: string[];
      to: ZoneId;
      at: InsertAt;
      groupId?: string | null;
      pos?: Pos | null;
      /** Play face down / play tapped, carried on the move so it is one step. */
      faceDown?: boolean;
      tapped?: boolean;
    }
  | { type: "REORDER_ZONE"; zone: ZoneId; order: string[] }
  | { type: "PEEK"; zone: ZoneId; from: "top" | "bottom"; count: number }
  | { type: "REVEAL"; ids: string[]; revealed: boolean }
  | { type: "SET_TAPPED"; cardId: string; tapped: boolean }
  | { type: "SET_FACE"; cardId: string; face: Face }
  | { type: "SET_NOTE"; cardId: string; note: string | null }
  | { type: "SET_ROTATION"; cardId: string; rotation: Rotation }
  | { type: "SET_CARD_FLAGS"; ids: string[]; flags: CardFlags }
  | { type: "ADD_COUNTER"; cardId: string; name: string; delta: number }
  | { type: "PROLIFERATE"; ids: string[] }
  | {
      type: "CREATE_EXTRA";
      ids: string[];
      spec: ExtraSpec;
      kind: "token" | "extra" | "copy";
      copiedFromId?: string | null;
      zone: ZoneId;
      pos?: Pos | null;
    }
  | { type: "DELETE_OBJECT"; cardId: string }
  | { type: "SHUFFLE"; zone: ZoneId; seed: number }
  | { type: "SET_LIFE"; delta: number }
  /** Absolute values only, so a stale click can never compound. `path` is
   *  `life`, `life2`, `poison`, `experience`, `energy`, `genericDamage`,
   *  `manaPool.<W|U|B|R|G|C>` or `commanderDamage.<label>`. */
  | { type: "SET_TRACKER"; path: string; value: number }
  | { type: "SET_LAYOUT"; placements: Placement[]; order?: string[] }
  | {
      type: "SET_GROUP";
      ids: string[];
      groupId: string | null;
      group?: { label?: string; arrangement?: GroupArrangement; anchor?: Pos };
    }
  | { type: "NEXT_TURN" }
  | { type: "SET_TURN"; turn: number }
  | { type: "ROLL"; kind: DiceKind; result: number }
  | { type: "MULLIGAN"; seed: number; /** A free mulligan: reshuffle and deal seven again without counting, so it adds no card to put on the bottom. */ free?: boolean }
  | { type: "KEEP"; bottomIds: string[] }
  | { type: "RANDOM_DISCARD"; cardId: string }
  | {
      type: "RECORD_INTERACTION";
      turn: number;
      rerollIndex: number;
      prompts: InteractionCategory[];
      resolution: InteractionResolution;
      reason?: string | null;
    }
  | { type: "SET_SIMULATOR"; settings: SimulatorSettings }
  | { type: "VOID_EVENT"; seq: number; voided: boolean }
  | { type: "BATCH"; commands: GameCommand[] }
  | { type: "RESTORE_SNAPSHOT"; snapshot: GameState };
