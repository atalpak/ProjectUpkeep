/**
 * Small store-level helpers the table and the shortcut layer share: nudging a
 * selection with the arrow keys, and the "targets" rule (the selection if
 * there is one, otherwise the card that has keyboard focus).
 */

import type { PlayStore } from "@/components/playtester/store";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { clampPos, resolvedPositions } from "@/lib/playtest/board/layout";

/**
 * Moves cards on the table by a fraction of the board. A grouped card moves its
 * group's anchor (positions are derived, never stored); a loose card gets a new
 * `pos`. Bursts are merged into ONE undo step by `mergeKey`, so holding an
 * arrow key is a single "undo", not fifty.
 */
export function nudge(store: PlayStore, ids: readonly string[], dx: number, dy: number): boolean {
  const game = store.get().game;
  if (!game || ids.length === 0) return false;
  const positions = resolvedPositions(game);
  const commands: GameCommand[] = [];
  const groups = new Set<string>();
  const placements: Array<{ id: string; x: number; y: number }> = [];
  for (const id of ids) {
    const card = game.cards[id];
    const pos = positions.get(id);
    if (!card || !pos) continue;
    if (card.groupId) {
      if (groups.has(card.groupId)) continue;
      groups.add(card.groupId);
      const anchor = game.groups[card.groupId].anchor;
      commands.push({ type: "SET_GROUP", ids: [], groupId: card.groupId, group: { anchor: clampPos({ x: anchor.x + dx, y: anchor.y + dy }) } });
    } else {
      placements.push({ id, x: pos.x + dx, y: pos.y + dy });
    }
  }
  if (placements.length > 0) commands.push({ type: "SET_LAYOUT", placements });
  if (commands.length === 0) return false;
  return store.dispatch(commands.length === 1 ? commands[0] : { type: "BATCH", commands }, { mergeKey: "nudge", toast: false });
}

/** The card that has keyboard focus on the table or in the hand, if any. Read
 *  from the DOM at the moment a shortcut fires, so there is no focus state to
 *  keep in sync. */
export function focusedCardId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const holder = active.closest<HTMLElement>("[data-card-id], [data-hand-card]");
  return holder?.dataset.cardId ?? holder?.dataset.handCard ?? null;
}

/** The selection, or the focused card when nothing is selected. */
export function targetsOf(store: PlayStore): string[] {
  const state = store.get();
  if (state.selection.length > 0) return [...state.selection];
  const focused = focusedCardId();
  if (focused && state.game && state.game.zones.battlefield.includes(focused)) return [focused];
  return [];
}
