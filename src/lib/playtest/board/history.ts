/**
 * Bounded undo/redo built on stored previous states — the "simplest correct
 * v1 form" the plan recommends for section 4.3, kept deliberately separate
 * from per-command inversion (`inverse.ts`). This is what a "undo" button
 * calls: pop the last recorded state and hand it back. `inverse.ts` exists
 * for the cases that want a semantic inverse command rather than a
 * full-state swap (e.g. a readable log entry, or a future networked replay).
 *
 * Capped at 200 entries (plan section 4.3) on both stacks so a very long
 * session cannot grow the in-memory history unboundedly.
 */

import type { GameState } from "./types";

const MAX_HISTORY = 200;

export type History = {
  past: GameState[];
  future: GameState[];
};

export function emptyHistory(): History {
  return { past: [], future: [] };
}

/** Call with the state as it was immediately before applying a
 *  state-changing command. Clears `future` — recording a new action after an
 *  undo abandons the redo branch, same as any standard undo stack. */
export function record(history: History, previous: GameState): History {
  return { past: [...history.past, previous].slice(-MAX_HISTORY), future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undo(history: History, current: GameState): { history: History; state: GameState } | null {
  if (history.past.length === 0) return null;
  const previous = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, MAX_HISTORY),
    },
    state: previous,
  };
}

export function redo(history: History, current: GameState): { history: History; state: GameState } | null {
  if (history.future.length === 0) return null;
  const [next, ...rest] = history.future;
  return {
    history: {
      past: [...history.past, current].slice(-MAX_HISTORY),
      future: rest,
    },
    state: next,
  };
}
