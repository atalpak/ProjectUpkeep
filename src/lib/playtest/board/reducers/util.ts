/**
 * Small pure helpers the reducers share. Nothing here records an event or
 * decides a rule; it is bookkeeping (find a card's zone, drop empty groups,
 * sanitise text) kept in one place so every reducer agrees on it.
 */

import { LIMITS, ZONE_IDS, type GameCard, type GameState, type ZoneId } from "../types";

export function zoneOf(state: GameState, id: string): ZoneId | null {
  for (const zone of ZONE_IDS) {
    if (state.zones[zone].includes(id)) return zone;
  }
  return null;
}

/** Builds id -> zone once, for reducers that ask about many cards. */
export function zoneIndex(state: GameState): Map<string, ZoneId> {
  const index = new Map<string, ZoneId>();
  for (const zone of ZONE_IDS) for (const id of state.zones[zone]) index.set(id, zone);
  return index;
}

/** Existing, de-duplicated ids in the order given. */
export function existingIds(state: GameState, ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (has(state.cards, id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** Drops groups that no card belongs to any more. Every reducer that can
 *  empty a group (a move, a delete, a regroup) ends by calling this, which is
 *  what lets the invariant "no empty groups" hold without each one remembering. */
export function pruneGroups(state: GameState): GameState {
  const live = new Set<string>();
  for (const id of state.zones.battlefield) {
    const groupId = state.cards[id]?.groupId;
    if (groupId) live.add(groupId);
  }
  const dead = Object.keys(state.groups).filter((gid) => !live.has(gid));
  if (dead.length === 0) return state;
  const groups = { ...state.groups };
  for (const gid of dead) delete groups[gid];
  return { ...state, groups };
}

export function cleanText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/** Only https URLs, capped. Anything else becomes "no image" rather than an
 *  arbitrary URL the browser (or a share reader) would fetch. */
export function cleanImageUrl(value: string | null | undefined): string | null {
  if (!value || value.length > LIMITS.imageUrl) return null;
  return /^https:\/\//i.test(value) ? value : null;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export function cardBucket(card: Pick<GameCard, "typeLine">): "creature" | "land" | "other" {
  const line = card.typeLine ?? "";
  if (/\bLand\b/.test(line)) return "land";
  if (/\bCreature\b/.test(line)) return "creature";
  return "other";
}

function numericPower(value: string | null): number {
  if (value === null) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Displayed power of one permanent: printed power plus offsets plus +1/+1 and
 *  -1/-1 counters. A convention for the "power in play" chart, not a rules
 *  calculation; `*` and other non-numbers count as 0. */
export function displayedPower(card: GameCard): number {
  return (
    numericPower(card.power) +
    card.ptOffset.power +
    (card.counters["+1/+1"] ?? 0) -
    (card.counters["-1/-1"] ?? 0)
  );
}

export function displayedToughness(card: GameCard): number {
  return (
    numericPower(card.toughness) +
    card.ptOffset.toughness +
    (card.counters["+1/+1"] ?? 0) -
    (card.counters["-1/-1"] ?? 0)
  );
}

/* -------------------------------------------------------------------------- */
/* Own-property access. Card ids, group ids, counter names and commander-damage
 * labels are all used as object keys, and some are typed by the player.
 * `"constructor" in {}` is true and `obj["__proto__"] = x` rewrites the
 * prototype instead of adding a key, so every keyed lookup in the core goes
 * through these rather than `in` or bare indexing. */

export function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return has(record, key) ? record[key] : undefined;
}

/** False for the one key that cannot be used as a plain-object property. */
export function safeKey(key: string): boolean {
  return key !== "__proto__";
}
