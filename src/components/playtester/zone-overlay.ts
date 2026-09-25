/**
 * The zone overlay's rules, kept out of the components so they can be tested
 * without a browser: which cards a request shows, whether closing it shuffles,
 * and the one function every way of closing goes through.
 *
 * Closing has to resolve the "shuffle on close" choice EXACTLY ONCE. The
 * overlay can be closed by Done, the X, Escape and a click outside, and with
 * "keep search open while dragging" on it stays open across drags, so a
 * shuffle that fired per-drag or per-close-path would be a real bug (extra
 * undo steps, a library reordered under the player's feet). The guard is the
 * dialog state itself: the first close flips it to null synchronously, so a
 * second close finds nothing open and does nothing.
 */

import type { ExternalStore, PlayStore } from "@/components/playtester/store";
import type { UiStore, ZoneBrowserRequest } from "@/components/playtester/ui-store";
import type { GameState, ZoneId } from "@/lib/playtest/board/types";
import type { Settings } from "@/lib/playtest/settings";

/** Only a library SEARCH shuffles on close. Browsing a graveyard, peeking at
 *  the top few cards, and a library "browse" do not: none of them is a search
 *  in the rules sense. */
export function shouldShuffleOnClose(request: ZoneBrowserRequest | null, shuffleOnClose: boolean): boolean {
  return request !== null && shuffleOnClose && request.zone === "library" && request.mode === "search";
}

/** The ids the overlay lists, in zone order, before the name filter. A peek
 *  shows only the cards that were peeked at, never the whole library. */
export function overlayZoneIds(game: GameState, request: ZoneBrowserRequest, zone: ZoneId): readonly string[] {
  if (request.mode === "peek" && zone === "library") {
    const count = Math.max(1, request.count ?? 3);
    return request.from === "bottom" ? game.zones.library.slice(-count) : game.zones.library.slice(0, count);
  }
  return game.zones[zone];
}

export function filterOverlayIds(game: GameState, ids: readonly string[], filter: string): string[] {
  const needle = filter.trim().toLowerCase();
  return ids.filter((id) => game.cards[id] !== undefined && game.cards[id].name.toLowerCase().includes(needle));
}

/** Whether cards in the overlay can be picked up with a pointer. Off by
 *  default; the card menu is always the way to move a card without dragging. */
export function overlayDragEnabled(settings: Pick<Settings, "keepSearchOpenWhileDragging">, pointerType: string): boolean {
  return settings.keepSearchOpenWhileDragging && pointerType !== "touch";
}

/**
 * Closes the zone overlay. Returns true when it closed something, false when
 * it was already closed (a second call from another close path).
 */
export function closeZoneOverlay(
  store: Pick<PlayStore, "dispatch">,
  ui: UiStore,
  settings: ExternalStore<Settings>,
  seed: () => number,
): boolean {
  const { dialog, zone } = ui.get();
  if (dialog !== "zone") return false;
  ui.set((s) => ({ ...s, dialog: null, zone: null }));
  if (shouldShuffleOnClose(zone, settings.get().shuffleOnClose)) {
    store.dispatch({ type: "SHUFFLE", zone: "library", seed: seed() });
  }
  return true;
}
