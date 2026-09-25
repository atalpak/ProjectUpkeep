/**
 * Hand ordering, as pure functions. "Sort my hand" is a `REORDER_ZONE` of the
 * hand only: it can never touch the library's order (the command refuses
 * anything that is not an exact rearrangement of that one zone), and a
 * `MOVE_MANY` of the whole hand is likewise a single step. What lives here is
 * just how to compute the order to send.
 *
 * Colours are not part of the game state (a card object carries its type line
 * and mana value but not its colours), so the caller passes a lookup, backed
 * in the UI by the catalogue the page loaded. A token or an unknown card is
 * colourless, and sorts with the other colourless cards.
 */

import type { GameCard, GameState } from "./board/types";

export type HandSort = "name" | "type" | "color" | "mv";

const TYPE_ORDER = ["Land", "Creature", "Artifact", "Enchantment", "Planeswalker", "Battle", "Instant", "Sorcery"];
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

function typeRank(card: GameCard): number {
  const line = card.typeLine ?? "";
  const index = TYPE_ORDER.findIndex((t) => new RegExp(`\\b${t}\\b`).test(line));
  return index === -1 ? TYPE_ORDER.length : index;
}

/** Colourless first, then each single colour in WUBRG order, then multicolour
 *  by how many colours and then by the first. */
function colorRank(colors: readonly string[]): number {
  if (colors.length === 0) return 0;
  const first = Math.max(0, COLOR_ORDER.indexOf(colors[0]));
  if (colors.length === 1) return 1 + first;
  return 10 + colors.length * 10 + first;
}

export function sortedHandOrder(state: GameState, key: HandSort, colorsOf: (card: GameCard) => readonly string[] = () => []): string[] {
  const cards = state.zones.hand.map((id) => state.cards[id]).filter((c): c is GameCard => c != null);
  const byName = (a: GameCard, b: GameCard) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const compare: Record<HandSort, (a: GameCard, b: GameCard) => number> = {
    name: byName,
    type: (a, b) => typeRank(a) - typeRank(b) || byName(a, b),
    color: (a, b) => colorRank(colorsOf(a)) - colorRank(colorsOf(b)) || byName(a, b),
    mv: (a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || byName(a, b),
  };
  return [...cards].sort(compare[key]).map((c) => c.id);
}

/** A uniformly chosen index in [0, count) from one RNG draw. The RNG is the
 *  caller's (the browser's), because the reducer takes the CHOSEN card, not a
 *  seed: what was discarded is what is recorded. */
export function randomIndex(count: number, rng: () => number): number {
  if (count <= 0) return -1;
  return Math.min(count - 1, Math.floor(rng() * count));
}
