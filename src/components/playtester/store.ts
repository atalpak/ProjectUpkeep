/**
 * The play store: the ONE place UI state for a game lives, outside React.
 *
 * Why an external store instead of `useState` in `PlayBoard` (the v1 shape):
 * v1 held the whole `GameState` in one component and handed it to every
 * panel, so tapping one card re-rendered the entire board (100 cards' worth of
 * menus, images and handlers). Here components subscribe to exactly the slice
 * they draw with `useSyncExternalStore` (hooks/useStore.ts): a card subscribes
 * to its own object, a pile to its own zone's id list. The reducers already
 * return the same reference for anything a command did not touch, so a
 * subscriber whose slice is unchanged does not re-render at all.
 *
 * `dispatch` is a stable function (it closes over the store, not over state)
 * so it can be passed to memoised children without invalidating them.
 *
 * What goes through `dispatch`:
 *  - one user gesture = one command = at most one undo step. A command that
 *    changes nothing (the reducer returned the same reference) records NO
 *    history and shows no toast; `PEEK` is applied but never undoable (looking
 *    at your library is not something to "undo");
 *  - `mergeKey` folds a burst of the same kind of change (arrow-key nudges)
 *    into the FIRST step's history entry when they arrive within
 *    `MERGE_WINDOW_MS` of each other, so ten nudges are one undo;
 *  - the wall-clock `ts` stamped on events is added HERE, in the browser,
 *    because the reducer is not allowed to know what time it is.
 *
 * The store never waits on animation or network. Animation is CSS, reading
 * state; nothing here is async.
 */

import { describeEvent } from "@/lib/playtest/board/events";
import { emptyHistory, record, redo as historyRedo, undo as historyUndo, type History } from "@/lib/playtest/board/history";
import { applyCommand } from "@/lib/playtest/board/reduce";
import type { GameCommand } from "@/lib/playtest/board/commands";
import type { GameState } from "@/lib/playtest/board/types";

export const MERGE_WINDOW_MS = 500;
const MAX_HISTORY_NOTE = 200;

export type ExternalStore<T> = {
  get: () => T;
  set: (update: (state: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const next = update(state);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Toast = { id: number; text: string; undoable: boolean };

export type LinkedSession = { id: string; title: string; updatedAt: string };

export type PlayState = {
  game: GameState | null;
  history: History;
  /** Battlefield selection, in the order it was made. */
  selection: readonly string[];
  /** Bumped on every change to `game`; drives autosave and dirty tracking. */
  revision: number;
  /** The revision last written to the account (or restored from it). */
  savedRevision: number;
  toast: Toast | null;
  session: LinkedSession | null;
  /** Transient: the id of the card the last command created or moved, for the
   *  brief arrival animation. */
  arrived: readonly string[];
};

export type DispatchOptions = {
  /** Overrides the toast text (otherwise the newest event's sentence). */
  label?: string;
  mergeKey?: string;
  /** Set false for commands that should not offer an Undo chip. */
  toast?: boolean;
};

export type PlayStore = ReturnType<typeof createPlayStore>;

export function createPlayStore(initial: Partial<PlayState> = {}) {
  const store = createExternalStore<PlayState>({
    game: null,
    history: emptyHistory(),
    selection: [],
    revision: 0,
    savedRevision: 0,
    toast: null,
    session: null,
    arrived: [],
    ...initial,
  });
  let toastId = 0;
  let lastMerge: { key: string; at: number } | null = null;

  function keepSelectable(game: GameState, selection: readonly string[]): readonly string[] {
    const onTable = new Set(game.zones.battlefield);
    const kept = selection.filter((id) => onTable.has(id));
    return kept.length === selection.length ? selection : kept;
  }

  function dispatch(command: GameCommand, options: DispatchOptions = {}): boolean {
    let changed = false;
    store.set((s) => {
      if (!s.game) return s;
      const next = applyCommand(s.game, command, { ts: Date.now() });
      if (next === s.game) return s;
      changed = true;

      const now = Date.now();
      const merge = options.mergeKey && lastMerge && lastMerge.key === options.mergeKey && now - lastMerge.at < MERGE_WINDOW_MS;
      lastMerge = options.mergeKey ? { key: options.mergeKey, at: now } : null;
      const history = command.type === "PEEK" || merge ? s.history : record(s.history, s.game);

      const fresh = next.events.filter((e) => e.seq >= s.game!.nextEventSeq && !e.private);
      const text = options.label ?? (fresh.length > 0 ? describeEvent(fresh[fresh.length - 1]) : null);
      const toast: Toast | null =
        options.toast === false || text === null ? s.toast : { id: ++toastId, text, undoable: command.type !== "PEEK" };

      // Cards this command brought onto (or moved within) the table, so the
      // arrival animation can find them. Cheap: compares battlefield ids.
      const before = new Set(s.game.zones.battlefield);
      const arrived = next.zones.battlefield.filter((id) => !before.has(id));

      return {
        ...s,
        game: next,
        history,
        selection: keepSelectable(next, s.selection),
        revision: s.revision + 1,
        toast,
        arrived: arrived.length > 0 ? arrived : s.arrived.length > 0 ? [] : s.arrived,
      };
    });
    return changed;
  }

  function undo() {
    lastMerge = null;
    store.set((s) => {
      if (!s.game) return s;
      const result = historyUndo(s.history, s.game);
      if (!result) return s;
      return { ...s, game: result.state, history: result.history, selection: keepSelectable(result.state, s.selection), revision: s.revision + 1, toast: null, arrived: [] };
    });
  }

  function redo() {
    lastMerge = null;
    store.set((s) => {
      if (!s.game) return s;
      const result = historyRedo(s.history, s.game);
      if (!result) return s;
      return { ...s, game: result.state, history: result.history, selection: keepSelectable(result.state, s.selection), revision: s.revision + 1, toast: null, arrived: [] };
    });
  }

  /** Replaces the whole game (new game, restored save, recovered game) and
   *  clears undo: history from a different game must never be reachable. */
  function replace(game: GameState | null, options: { saved?: boolean; session?: LinkedSession | null } = {}) {
    lastMerge = null;
    store.set((s) => ({
      ...s,
      game,
      history: emptyHistory(),
      selection: [],
      revision: s.revision + 1,
      savedRevision: options.saved ? s.revision + 1 : s.savedRevision,
      toast: null,
      session: options.session === undefined ? null : options.session,
      arrived: [],
    }));
  }

  function setSelection(ids: readonly string[]) {
    store.set((s) => {
      if (ids.length === s.selection.length && ids.every((id, i) => id === s.selection[i])) return s;
      return { ...s, selection: s.game ? keepSelectable(s.game, ids) : [] };
    });
  }

  function toggleSelected(id: string) {
    store.set((s) => {
      if (!s.game) return s;
      const has = s.selection.includes(id);
      return { ...s, selection: has ? s.selection.filter((x) => x !== id) : keepSelectable(s.game, [...s.selection, id]) };
    });
  }

  function dismissToast(id?: number) {
    store.set((s) => (s.toast && (id === undefined || s.toast.id === id) ? { ...s, toast: null } : s));
  }

  function markSaved(session?: LinkedSession | null) {
    store.set((s) => ({ ...s, savedRevision: s.revision, session: session === undefined ? s.session : session }));
  }

  function setSession(session: LinkedSession | null) {
    store.set((s) => (s.session === session ? s : { ...s, session }));
  }

  return {
    get: store.get,
    subscribe: store.subscribe,
    dispatch,
    undo,
    redo,
    replace,
    setSelection,
    toggleSelected,
    dismissToast,
    markSaved,
    setSession,
    maxHistory: MAX_HISTORY_NOTE,
  };
}

/** True when there is anything the account save does not have yet. */
export function isUnsaved(state: PlayState): boolean {
  return state.game !== null && state.revision !== state.savedRevision;
}
