"use client";

import { useSyncExternalStore } from "react";

import { cx } from "@/components/ui";

/**
 * How card details are delivered on a desktop pointer: the docked sidebar, or a
 * hover tooltip.
 *
 * Treated as an external store rather than React state, for the same reason the
 * price and column preferences are: it lives in localStorage, the server cannot
 * read it, and reading it in an effect to call setState is the pattern React now
 * warns about.
 *
 * Touch devices ignore this entirely — there is no hover to hang either
 * behaviour off, so they get a sheet on tap regardless. See CardPanel.tsx.
 */

export const CARD_PREVIEW_STORAGE_KEY = "mtgmanager-card-preview";

export const CARD_PREVIEW_MODES = ["sidebar", "tooltip"] as const;
export type CardPreviewMode = (typeof CARD_PREVIEW_MODES)[number];

export const DEFAULT_CARD_PREVIEW_MODE: CardPreviewMode = "sidebar";

const listeners = new Set<() => void>();

/** Holds the choice when localStorage refuses the write. */
let unsaved: string | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the choice should be reflected here too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): string | null {
  try {
    return unsaved ?? localStorage.getItem(CARD_PREVIEW_STORAGE_KEY);
  } catch {
    return unsaved;
  }
}

/** The server cannot read storage; the default stands in until hydration. */
const readOnServer = (): string | null => null;

export function setCardPreviewMode(mode: CardPreviewMode): void {
  try {
    localStorage.setItem(CARD_PREVIEW_STORAGE_KEY, mode);
    unsaved = null;
  } catch {
    // Storage blocked: keep it in memory so the choice still applies for the
    // rest of this page view, even though it will not outlive it.
    unsaved = mode;
  }
  for (const listener of listeners) listener();
}

export function useCardPreviewMode(): CardPreviewMode {
  const stored = useSyncExternalStore(subscribe, read, readOnServer);
  return (CARD_PREVIEW_MODES as readonly string[]).includes(stored ?? "")
    ? (stored as CardPreviewMode)
    : DEFAULT_CARD_PREVIEW_MODE;
}

/**
 * The header switch.
 *
 * Hidden below `xl`, where neither mode applies — there is no docked sidebar at
 * that width and touch gets a sheet either way, so offering the choice would be
 * offering a setting that does nothing.
 */
export function CardPreviewToggle({ className }: { className?: string }) {
  const mode = useCardPreviewMode();
  const showing = mode === "sidebar";

  const label = showing
    ? "Hide the card sidebar (show details on hover instead)"
    : "Show the card sidebar";

  return (
    <button
      type="button"
      onClick={() => setCardPreviewMode(showing ? "tooltip" : "sidebar")}
      aria-pressed={showing}
      aria-label={label}
      title={label}
      className={cx(
        "hidden size-9 items-center justify-center rounded-md border border-border",
        "transition-colors hover:bg-surface-muted hover:text-ink xl:inline-flex",
        showing ? "text-ink" : "text-ink-muted",
        className,
      )}
    >
      {/* A page with a right-hand rail; the rail is filled when the sidebar is on. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        className="size-4"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
        {showing ? <path d="M15 4h6v16h-6z" fill="currentColor" stroke="none" /> : null}
      </svg>
    </button>
  );
}
