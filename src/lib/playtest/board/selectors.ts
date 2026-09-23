/**
 * Read-only views over `GameState` — zone contents, card lookup, grouping.
 * Nothing here derives new game state; it exists so the eventual React layer
 * (and tests) don't reimplement "look up every card in a zone" by hand.
 */

import type { GameCard, GameState, ZoneId } from "./types";

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

export function recentLog(state: GameState, count = 20): GameState["log"] {
  return state.log.slice(-count);
}
