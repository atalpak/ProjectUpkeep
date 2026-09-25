/**
 * Versioned snapshot validation. Nothing renders, restores, saves or shares a
 * stored blob as a `GameState` without going through here: a malformed,
 * unknown-version or cross-version snapshot must fail safely instead of
 * crashing the board or being coerced into something that half works.
 *
 * The rule that makes this safe to put in front of a database and a public
 * projection: every object is REBUILT field by field from typed reads. Unknown
 * fields are dropped, never copied through, so a save can never smuggle extra
 * keys into a later share, and every string, number and array has a cap. After
 * the rebuild `checkInvariants` (invariants.ts, the same list the property
 * test runs after every command) must come back empty; that is what catches a
 * card in two zones, a zone naming a missing card, or a position off the board.
 *
 * Version 1 is migrated first (migrate.ts) and then validated like any other.
 */

import { defaultSimulatorSettings, LIMITS, MANA_KEYS, ZONE_IDS, INTERACTION_CATEGORIES, type EventKind, type GameCard, type GameEvent, type GameState, type Group, type ZoneId } from "./types";
import { isFingerprint } from "./fingerprint";
import { checkInvariants } from "./invariants";
import { migrateV1ToV2 } from "./migrate";
import { sanitizeSettings } from "./reducers/simulator";
import { safeKey } from "./reducers/util";

export class SnapshotValidationError extends Error {}

function fail(reason: string): never {
  throw new SnapshotValidationError(reason);
}

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A key that will be used on a plain object. See `safeKey` in reducers/util. */
function key(value: string, what: string, max: number): string {
  const checked = str(value, what, max);
  if (!safeKey(checked)) fail(`${what} is a reserved name.`);
  return checked;
}

function str(value: unknown, what: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${what} is not a string.`);
  if (value.length > max) fail(`${what} is longer than ${max} characters.`);
  if (!allowEmpty && value.length === 0) fail(`${what} is empty.`);
  return value;
}

function strOrNull(value: unknown, what: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  return str(value, what, max, true);
}

function int(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(`${what} is not an integer.`);
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} is not a finite number.`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") fail(`${what} is not a boolean.`);
  return value;
}

function rec(value: unknown, what: string): Rec {
  if (!isRecord(value)) fail(`${what} is not an object.`);
  return value;
}

function arr(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list.`);
  if (value.length > max) fail(`${what} has more than ${max} entries.`);
  return value;
}

function pos(value: unknown, what: string): { x: number; y: number } | null {
  if (value === null || value === undefined) return null;
  const r = rec(value, what);
  return { x: num(r.x, `${what}.x`), y: num(r.y, `${what}.y`) };
}

const FACES = ["front", "back", "face-down"] as const;
const KINDS = ["deck-card", "token", "copy", "extra"] as const;
const ROTATIONS = [0, 90, 180, 270] as const;
const EVENT_KINDS: readonly EventKind[] = [
  "start", "draw", "mill", "move", "flags", "counter", "proliferate", "create", "delete", "shuffle", "mulligan",
  "keep", "peek", "reveal", "tracker", "turn", "roll", "layout", "group", "note", "reorder", "discard",
  "interaction", "simulator", "restore",
];

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value as T)) fail(`${what} has an unknown value.`);
  return value as T;
}

function readCard(id: string, value: unknown): GameCard {
  const r = rec(value, `Card "${id}"`);
  if (r.id !== id) fail(`Card "${id}" has a mismatched id.`);
  const counters: Record<string, number> = {};
  for (const [name, count] of Object.entries(rec(r.counters, `Card "${id}" counters`))) {
    counters[key(name, "A counter name", LIMITS.counterName)] = int(count, `Counter "${name}"`);
  }
  const offset = rec(r.ptOffset, `Card "${id}" ptOffset`);
  return {
    id,
    kind: oneOf(r.kind, KINDS, `Card "${id}" kind`),
    cardId: strOrNull(r.cardId, "cardId", 100),
    oracleId: strOrNull(r.oracleId, "oracleId", 100),
    name: str(r.name, `Card "${id}" name`, LIMITS.name),
    typeLine: strOrNull(r.typeLine, "typeLine", LIMITS.name),
    manaValue: r.manaValue === null || r.manaValue === undefined ? null : num(r.manaValue, "manaValue"),
    producesMana: bool(r.producesMana, `Card "${id}" producesMana`),
    imageSmall: strOrNull(r.imageSmall, "imageSmall", LIMITS.imageUrl),
    imageNormal: strOrNull(r.imageNormal, "imageNormal", LIMITS.imageUrl),
    imageBack: strOrNull(r.imageBack, "imageBack", LIMITS.imageUrl),
    face: oneOf(r.face, FACES, `Card "${id}" face`),
    tapped: bool(r.tapped, `Card "${id}" tapped`),
    rotation: oneOf(r.rotation, ROTATIONS, `Card "${id}" rotation`),
    dimmed: bool(r.dimmed, `Card "${id}" dimmed`),
    revealed: bool(r.revealed, `Card "${id}" revealed`),
    counters,
    note: strOrNull(r.note, "note", LIMITS.note),
    copiedFromId: strOrNull(r.copiedFromId, "copiedFromId", 100),
    groupId: strOrNull(r.groupId, "groupId", 40),
    power: strOrNull(r.power, "power", 8),
    toughness: strOrNull(r.toughness, "toughness", 8),
    ptOffset: { power: int(offset.power, "ptOffset.power"), toughness: int(offset.toughness, "ptOffset.toughness") },
    commanderTax: int(r.commanderTax, `Card "${id}" commanderTax`),
    pos: pos(r.pos, `Card "${id}" pos`),
  };
}

function readEvent(value: unknown): GameEvent {
  const r = rec(value, "An event");
  const data: GameEvent["data"] = {};
  const rawData = rec(r.data, "Event data");
  const keys = Object.keys(rawData);
  if (keys.length > 20) fail("An event has too much data.");
  for (const key of keys) {
    const v = rawData[key];
    if (v === null || typeof v === "boolean") data[key] = v;
    else if (typeof v === "number" && Number.isFinite(v)) data[key] = v;
    else if (typeof v === "string" && v.length <= 200) data[key] = v;
    else fail(`Event data "${key}" is not a small primitive.`);
  }
  if (Object.prototype.hasOwnProperty.call(rawData, "__proto__")) fail("Event data uses a reserved name.");
  const zone = (v: unknown, what: string): ZoneId | null => (v === null || v === undefined ? null : oneOf(v, ZONE_IDS, what));
  return {
    seq: int(r.seq, "Event seq"),
    gestureId: int(r.gestureId, "Event gestureId"),
    turn: int(r.turn, "Event turn"),
    ts: num(r.ts, "Event ts"),
    kind: oneOf(r.kind, EVENT_KINDS, "Event kind"),
    ids: arr(r.ids, "Event ids", 200).map((v) => str(v, "An event id", 100)),
    names: arr(r.names, "Event names", 200).map((v) => str(v, "An event name", LIMITS.name)),
    from: zone(r.from, "Event from"),
    to: zone(r.to, "Event to"),
    data,
    voided: bool(r.voided, "Event voided"),
    private: bool(r.private, "Event private"),
  };
}

export function validateSnapshot(input: unknown): GameState {
  let data = rec(input, "Snapshot");
  if (data.schemaVersion === 1) data = migrateV1ToV2(data);
  if (data.schemaVersion !== 2) fail(`Unsupported schema version: ${JSON.stringify(data.schemaVersion)}.`);

  const rawCards = rec(data.cards, "The card table");
  const ids = Object.keys(rawCards);
  if (ids.length > LIMITS.cards) fail("The card table is too large.");
  const cards: Record<string, GameCard> = {};
  for (const id of ids) cards[key(id, "A card id", 100)] = readCard(id, rawCards[id]);

  const rawZones = rec(data.zones, "Zones");
  const zones = {} as Record<ZoneId, string[]>;
  for (const zone of ZONE_IDS) {
    zones[zone] = arr(rawZones[zone], `Zone "${zone}"`, LIMITS.cards).map((v) => str(v, `A card id in "${zone}"`, 100));
  }

  const rawGroups = rec(data.groups, "Groups");
  if (Object.keys(rawGroups).length > 200) fail("Too many groups.");
  const groups: Record<string, Group> = {};
  for (const [gid, value] of Object.entries(rawGroups)) {
    const g = rec(value, `Group "${gid}"`);
    const anchor = pos(g.anchor, `Group "${gid}" anchor`);
    if (!anchor) fail(`Group "${gid}" has no anchor.`);
    groups[key(gid, "A group id", 40)] = {
      label: str(g.label, `Group "${gid}" label`, LIMITS.groupLabel, true),
      arrangement: oneOf(g.arrangement, ["row", "column", "stack"] as const, `Group "${gid}" arrangement`),
      anchor,
    };
  }

  const cfg = rec(data.config, "Config");
  const trk = rec(data.trackers, "Trackers");
  const pool = rec(trk.manaPool, "Mana pool");
  const manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const key of MANA_KEYS) manaPool[key] = int(pool[key], `Mana ${key}`);
  const commanderDamage: Record<string, number> = {};
  for (const [label, value] of Object.entries(rec(trk.commanderDamage, "Commander damage"))) {
    commanderDamage[key(label, "A commander damage label", LIMITS.groupLabel)] = int(value, `Commander damage "${label}"`);
  }

  const opening = rec(data.opening, "Opening");
  const source = rec(data.source, "Source");
  const fingerprint = source.fingerprint;
  if (!isFingerprint(fingerprint)) fail("The deck fingerprint is not a 64-character hex digest.");

  const sim = rec(data.simulator, "Simulator");
  const results = arr(sim.results, "Simulator results", 300).map((value) => {
    const r = rec(value, "A simulator result");
    return {
      turn: int(r.turn, "Result turn"),
      rerollIndex: int(r.rerollIndex, "Result rerollIndex"),
      prompts: arr(r.prompts, "Result prompts", 3).map((p) => oneOf(p, INTERACTION_CATEGORIES, "A prompt")),
      resolution: oneOf(r.resolution, ["pending", "ignored", "resolved", "rerolled"] as const, "Result resolution"),
      reason: strOrNull(r.reason, "Result reason", 200),
    };
  });

  const state: GameState = {
    schemaVersion: 2,
    deckId: str(data.deckId, "deckId", 100),
    source: { fingerprint, deckSize: int(source.deckSize, "deckSize") },
    seed: num(data.seed, "seed"),
    config: {
      format: oneOf(cfg.format, ["commander", "constructed"] as const, "format"),
      startingLife: int(cfg.startingLife, "startingLife"),
      freeMulligan: oneOf(cfg.freeMulligan, ["none", "first"] as const, "freeMulligan"),
      firstTurnDraws: bool(cfg.firstTurnDraws, "firstTurnDraws"),
      commanderIds: arr(cfg.commanderIds, "commanderIds", 10).map((v) => str(v, "A commander id", 100)),
    },
    opening: { status: oneOf(opening.status, ["deciding", "kept"] as const, "opening status"), mulligans: int(opening.mulligans, "mulligans") },
    turn: int(data.turn, "turn"),
    trackers: {
      life: int(trk.life, "life"),
      life2: int(trk.life2, "life2"),
      poison: int(trk.poison, "poison"),
      experience: int(trk.experience, "experience"),
      energy: int(trk.energy, "energy"),
      manaPool,
      commanderDamage,
      genericDamage: int(trk.genericDamage, "genericDamage"),
    },
    cards,
    zones,
    groups,
    events: arr(data.events, "Events", LIMITS.events).map(readEvent),
    nextEventSeq: int(data.nextEventSeq, "nextEventSeq"),
    eventsTruncatedBefore: data.eventsTruncatedBefore === null || data.eventsTruncatedBefore === undefined ? null : int(data.eventsTruncatedBefore, "eventsTruncatedBefore"),
    simulator: { settings: sanitizeSettings({ ...defaultSimulatorSettings(), ...rec(sim.settings, "Simulator settings") } as ReturnType<typeof defaultSimulatorSettings>), seed: num(sim.seed, "simulator seed"), results },
  };

  const problems = checkInvariants(state);
  if (problems.length > 0) fail(`Snapshot is inconsistent: ${problems.slice(0, 3).join("; ")}.`);
  return state;
}

/** Never throws: for a caller that wants a plain yes/no ("can I offer
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

/** Save budget: the database cap is 262,144 bytes; aim under it so the check
 *  constraint never fires on a save the player just made. */
export const SAVE_SOFT_CAP = 240_000;

/**
 * Shrinks a state to fit a save: drops the OLDEST events in slices until the
 * JSON fits, and records `eventsTruncatedBefore` so charts and exports can say
 * their data is partial rather than pretend. Only the log is ever trimmed; the
 * board is never touched. Returns the input unchanged when it already fits.
 */
export function fitForSave(state: GameState, maxChars: number = SAVE_SOFT_CAP): GameState {
  let current = state;
  while (JSON.stringify(current).length > maxChars && current.events.length > 0) {
    const dropped = Math.max(1, Math.min(100, current.events.length));
    const events = current.events.slice(dropped);
    current = { ...current, events, eventsTruncatedBefore: events.length > 0 ? events[0].seq : current.nextEventSeq };
  }
  return current;
}
