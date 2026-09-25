"use client";

import { usePlayStore, useSelector } from "./hooks/useStore";

/** Undo and redo, fixed in the top bar so they never move with the hand. */
function Round({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink transition hover:brightness-125 disabled:opacity-35 motion-safe:active:scale-95 coarse:size-11"
    >
      {children}
    </button>
  );
}

export function UndoRedo() {
  const store = usePlayStore();
  const canUndo = useSelector((s) => s.history.past.length > 0);
  const canRedo = useSelector((s) => s.history.future.length > 0);
  return (
    <div className="flex items-center gap-1.5">
      <Round label="Undo" disabled={!canUndo} onClick={() => store.undo()}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
      </Round>
      <Round label="Redo" disabled={!canRedo} onClick={() => store.redo()}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
      </Round>
    </div>
  );
}
