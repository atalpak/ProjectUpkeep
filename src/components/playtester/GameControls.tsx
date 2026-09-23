"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { canRedo, canUndo, type History } from "@/lib/playtest/board/history";
import type { GameState } from "@/lib/playtest/board/types";

/**
 * Life, turn, mulligan, restart, and undo/redo — the always-visible strip at
 * the foot of the board (plan section 3.2). Dice is a plain client-side
 * utility (a d6/d20 roll shown as a transient result) rather than a
 * `GameState` field: there is no dice command in the Phase 1 union and a die
 * roll has no meaningful "undo" the way a card move does, so it deliberately
 * never touches history or the action log.
 */
export function GameControls({
  state,
  history,
  dispatch,
  onUndo,
  onRedo,
  onMulligan,
  onNewGame,
  mulliganDisabled,
}: {
  state: GameState;
  history: History;
  dispatch: (command: GameCommand) => void;
  onUndo: () => void;
  onRedo: () => void;
  onMulligan: () => void;
  onNewGame: () => void;
  mulliganDisabled: boolean;
}) {
  const [roll, setRoll] = useState<number | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Life</span>
        <Button type="button" variant="secondary" onClick={() => dispatch({ type: "SET_LIFE", delta: -1 })}>
          −1
        </Button>
        <span className="w-10 text-center font-display text-lg font-semibold tabular-nums">{state.life}</span>
        <Button type="button" variant="secondary" onClick={() => dispatch({ type: "SET_LIFE", delta: 1 })}>
          +1
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Turn</span>
        <span className="w-6 text-center font-display text-lg font-semibold tabular-nums">{state.turn}</span>
        <Button type="button" variant="secondary" onClick={() => dispatch({ type: "NEXT_TURN" })}>
          Next turn
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setRoll(1 + Math.floor(Math.random() * 6));
          }}
        >
          Roll d6
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setRoll(1 + Math.floor(Math.random() * 20));
          }}
        >
          Roll d20
        </Button>
        {roll !== null ? <span className="text-sm font-medium tabular-nums">Rolled {roll}</span> : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button type="button" variant="secondary" onClick={onMulligan} disabled={mulliganDisabled}>
          Mulligan
        </Button>
        <Button type="button" variant="secondary" onClick={onUndo} disabled={!canUndo(history)} title="Ctrl/Cmd+Z">
          Undo
        </Button>
        <Button type="button" variant="secondary" onClick={onRedo} disabled={!canRedo(history)} title="Ctrl/Cmd+Shift+Z">
          Redo
        </Button>
        <Button type="button" variant="danger" onClick={onNewGame}>
          Restart
        </Button>
      </div>
    </div>
  );
}
