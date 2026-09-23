"use client";

import { recentLog } from "@/lib/playtest/board/selectors";
import type { GameState } from "@/lib/playtest/board/types";

/**
 * The readable recent-action list `reduce.ts` already produces on every
 * command (`GameState.log`) — this just renders it, newest at the top.
 */
export function ActionLog({ state }: { state: GameState }) {
  const entries = [...recentLog(state, 30)].reverse();

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent actions</p>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing has happened yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm text-ink-muted">
              <span className="mr-1.5 tabular-nums text-ink">T{entry.turn}</span>
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
