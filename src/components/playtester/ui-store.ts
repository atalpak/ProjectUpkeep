/**
 * UI state that is not the game: which dialog is open, the card menu, the
 * inspector, the drag in progress. A second, tiny external store (the same
 * `createExternalStore` the game uses) rather than `useState` in `PlayBoard`,
 * for the same reason the game is external: opening a dialog must not
 * re-render the battlefield.
 *
 * `hoverZone` and `guides` change on every pointer move while dragging, so
 * they live here and not in the game store: nothing about a drag in flight is
 * game state, and none of it is undoable or saved. The dragged cards
 * themselves move by a CSS transform written straight to their elements
 * (drag.ts), not through any store at all.
 */

import { createExternalStore, type ExternalStore } from "@/components/playtester/store";
import type { ZoneId } from "@/lib/playtest/board/types";

export type DialogId =
  | "start"
  | "sessions"
  | "share"
  | "settings"
  | "log"
  | "metrics"
  | "export"
  | "shortcuts"
  | "palette"
  | "token"
  | "counters"
  | "hand"
  | "zone"
  | "zones"
  | "interaction"
  | "note"
  | "confirm-restart"
  | "dice-result";

export type MenuTarget = { cardId: string; x: number; y: number; opener: HTMLElement | null };

export type ZoneBrowserRequest = { zone: ZoneId; mode: "browse" | "search" | "peek"; from?: "top" | "bottom"; count?: number };

export type UiState = {
  dialog: DialogId | null;
  /** Free-form payload for the open dialog (e.g. which zone to browse). */
  zone: ZoneBrowserRequest | null;
  counterTarget: readonly string[];
  noteTarget: string | null;
  menu: MenuTarget | null;
  /** The card being previewed. `big` = hold-to-inspect (I key / long press):
   *  the whole card, large, centred. Otherwise a hover preview at the side. */
  inspect: { cardId: string; big: boolean } | null;
  /** The drop target under a card being dragged, for the highlight + label. */
  hoverZone: ZoneId | "hand" | "battlefield" | null;
  dragging: boolean;
  guides: { x: number | null; y: number | null };
  /** True while the hand is covered (Hand options > Hide hand). */
  handHidden: boolean;
  diceResult: { text: string; id: number } | null;
  /** Held on the library: show its card back large, for as long as it is held. */
  backPreview: boolean;
  /** The player pressed Next turn and is deciding on an upkeep / interaction step. */
  pendingTurn: boolean;
  announce: string;
};

export type UiStore = ExternalStore<UiState>;

export function createUiStore(): UiStore {
  return createExternalStore<UiState>({
    dialog: null,
    zone: null,
    counterTarget: [],
    noteTarget: null,
    menu: null,
    inspect: null,
    hoverZone: null,
    dragging: false,
    guides: { x: null, y: null },
    handHidden: false,
    diceResult: null,
    backPreview: false,
    pendingTurn: false,
    announce: "",
  });
}
