/**
 * Read-only views over `GameState`. Nothing here derives new game state; it
 * exists so the UI (and tests) never reimplement "look up every card in a
 * zone" or "add up the selected power" by hand.
 */

import { displayedPower, displayedToughness } from "./reducers/util";
import type { GameCard, GameEvent, GameState, ZoneId } from "./types";

export function getCard(state: GameState, cardId: string): GameCard | null {
  return state.cards[cardId] ?? null;
}

export function getZone(state: GameState, zone: ZoneId): GameCard[] {
  return state.zones[zone].map((id) => state.cards[id]).filter((card): card is GameCard => card != null);
}

export function zoneCount(state: GameState, zone: ZoneId): number {
  return state.zones[zone].length;
}

/** Battlefield cards grouped by `groupId` (ungrouped cards share the `null`
 *  key), in board order within each group. */
export function getBattlefieldGroups(state: GameState): Map<string | null, GameCard[]> {
  const groups = new Map<string | null, GameCard[]>();
  for (const card of getZone(state, "battlefield")) {
    const list = groups.get(card.groupId) ?? [];
    list.push(card);
    groups.set(card.groupId, list);
  }
  return groups;
}

/** Events that still describe the record: voided ones are hidden by default. */
export function recentEvents(state: GameState, count = 20): GameEvent[] {
  return state.events.filter((e) => !e.voided).slice(-count);
}

/** Selected-card readout: how many, and total displayed power / toughness.
 *  "Displayed" = printed + offsets + +1/+1 counters; a convention, not rules. */
export function selectionTotals(state: GameState, ids: readonly string[]): { count: number; power: number; toughness: number } {
  let count = 0;
  let power = 0;
  let toughness = 0;
  for (const id of ids) {
    const card = state.cards[id];
    if (!card) continue;
    count++;
    power += displayedPower(card);
    toughness += displayedToughness(card);
  }
  return { count, power, toughness };
}

/** True when the player has done anything beyond the opening-hand decision:
 *  the "are you sure?" test for restart / load. */
export function isDirty(state: GameState): boolean {
  const setup = new Set(["start", "mulligan", "keep", "shuffle"]);
  return state.turn > 0 || state.events.some((e) => !setup.has(e.kind));
}
