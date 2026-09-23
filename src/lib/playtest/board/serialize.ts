/**
 * Versioned snapshot validation (plan section 5.3). Nothing renders a stored
 * or pasted blob as a `GameState` without going through here first — a
 * malformed, unknown-version, or cross-version snapshot must fail safely
 * rather than crash the board or silently coerce into a broken state.
 *
 * There is exactly one schema version so far (`schemaVersion: 1`).
 * `validateSnapshot` is where a future version's migration step would be
 * added, ahead of the final shape check.
 */

import { ZONE_IDS, type GameCard, type GameState, type ZoneId } from "./types";

export class SnapshotValidationError extends Error {}

function fail(reason: string): never {
  throw new SnapshotValidationError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FACES = ["front", "back", "face-down"];
const KINDS = ["deck-card", "token", "copy"];
const ROTATIONS = [0, 90, 180, 270];

function validateCard(id: string, value: unknown): GameCard {
  if (!isRecord(value)) fail(`Card "${id}" is not an object.`);
  if (value.id !== id) fail(`Card "${id}" has a mismatched id.`);
  if (typeof value.name !== "string") fail(`Card "${id}" has no name.`);
  if (!KINDS.includes(value.kind as string)) fail(`Card "${id}" has an unknown kind.`);
  if (!FACES.includes(value.face as string)) fail(`Card "${id}" has an unknown face.`);
  if (typeof value.tapped !== "boolean") fail(`Card "${id}" has a non-boolean tapped.`);
  if (!ROTATIONS.includes(value.rotation as number)) fail(`Card "${id}" has an invalid rotation.`);
  if (!isRecord(value.counters)) fail(`Card "${id}" has invalid counters.`);
  return value as unknown as GameCard;
}

export function validateSnapshot(data: unknown): GameState {
  if (!isRecord(data)) fail("Snapshot is not an object.");
  if (data.schemaVersion !== 1) fail(`Unsupported schema version: ${JSON.stringify(data.schemaVersion)}.`);
  if (typeof data.deckId !== "string") fail("Snapshot has no deckId.");
  if (typeof data.seed !== "number") fail("Snapshot has no seed.");
  if (typeof data.turn !== "number") fail("Snapshot has no turn.");
  if (typeof data.life !== "number") fail("Snapshot has no life.");
  if (!isRecord(data.commanderDamage)) fail("Snapshot has no commanderDamage.");
  if (!isRecord(data.cards)) fail("Snapshot has no card table.");
  if (!isRecord(data.zones)) fail("Snapshot has no zones.");
  if (!Array.isArray(data.log)) fail("Snapshot has no log.");

  const cards: Record<string, GameCard> = {};
  for (const [id, value] of Object.entries(data.cards)) {
    cards[id] = validateCard(id, value);
  }

  const rawZones = data.zones as Record<string, unknown>;
  const zones = {} as Record<ZoneId, string[]>;
  for (const zone of ZONE_IDS) {
    const list = rawZones[zone];
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === "string")) {
      fail(`Snapshot zone "${zone}" is missing or malformed.`);
    }
    for (const cardId of list as string[]) {
      if (!(cardId in cards)) fail(`Snapshot zone "${zone}" references unknown card "${cardId}".`);
    }
    zones[zone] = list as string[];
  }

  return {
    schemaVersion: 1,
    deckId: data.deckId,
    seed: data.seed,
    turn: data.turn,
    life: data.life,
    commanderDamage: data.commanderDamage as Record<string, number>,
    cards,
    zones,
    log: data.log as GameState["log"],
  };
}

/** Never throws — for a caller that wants a plain yes/no ("can I offer
 *  resume?") instead of a caught exception. */
export function tryValidateSnapshot(data: unknown): GameState | null {
  try {
    return validateSnapshot(data);
  } catch (err) {
    if (err instanceof SnapshotValidationError) return null;
    throw err;
  }
}

export function serializeSnapshot(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeSnapshot(raw: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Snapshot is not valid JSON.");
  }
  return validateSnapshot(parsed);
}
