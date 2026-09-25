"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { ExternalStore, PlayState, PlayStore } from "@/components/playtester/store";
import type { GameCard, GameState, ZoneId } from "@/lib/playtest/board/types";

/**
 * Context + subscription hooks for the play store (store.ts).
 *
 * The rule that keeps a 100-card table fast: a component reads the SMALLEST
 * slice it draws. `useCard(id)` re-renders only when that one card object
 * changes identity (the reducers keep untouched cards by reference), `useZoneIds`
 * only when that zone's id list changes, `useIsSelected(id)` returns a boolean
 * so selecting card A does not re-render card B. A selector must return a
 * stable value (a stored reference or a primitive), never a freshly built
 * array or object, or `useSyncExternalStore` would loop.
 */

const PlayStoreContext = createContext<PlayStore | null>(null);
export const PlayStoreProvider = PlayStoreContext.Provider;

export function usePlayStore(): PlayStore {
  const store = useContext(PlayStoreContext);
  if (!store) throw new Error("usePlayStore must be used inside <PlayStoreProvider>.");
  return store;
}

export function useSelector<T>(selector: (state: PlayState) => T): T {
  const store = usePlayStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/** Generic subscription for the small non-game stores (UI state). */
export function useExternal<S, T>(store: ExternalStore<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

const NO_IDS: readonly string[] = Object.freeze([]);

export const useGame = (): GameState | null => useSelector((s) => s.game);
export const useCard = (id: string): GameCard | null => useSelector((s) => s.game?.cards[id] ?? null);
export const useZoneIds = (zone: ZoneId): readonly string[] => useSelector((s) => s.game?.zones[zone] ?? NO_IDS);
export const useIsSelected = (id: string): boolean => useSelector((s) => s.selection.includes(id));
export const useSelection = (): readonly string[] => useSelector((s) => s.selection);
export const useTurn = (): number => useSelector((s) => s.game?.turn ?? 0);
