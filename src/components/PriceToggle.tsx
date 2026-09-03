"use client";

import { useSyncExternalStore } from "react";

import { PRICES_STORAGE_KEY } from "@/lib/collection/pricing";
import { cx } from "@/components/ui";

/**
 * One switch for showing prices, shared by every view that can show them.
 *
 * Treated as an external store rather than React state, for the same reason the
 * column choice is: it lives in localStorage, the server cannot read it, and
 * reading it in an effect to call setState is the pattern React now warns
 * about. Subscribing means the collection, deck and trade views all agree
 * without passing a prop through the tree.
 */

const listeners = new Set<() => void>();

/** Holds the choice when localStorage refuses the write. */
let unsaved: string | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): string | null {
  try {
    return unsaved ?? localStorage.getItem(PRICES_STORAGE_KEY);
  } catch {
    return unsaved;
  }
}

/** Off on the server, so the markup React hydrates matches. */
const readOnServer = (): string | null => null;

function write(showing: boolean): void {
  const value = showing ? "1" : "0";
  try {
    localStorage.setItem(PRICES_STORAGE_KEY, value);
    unsaved = null;
  } catch {
    unsaved = value;
  }
  for (const listener of listeners) listener();
}

/** Whether prices should be shown right now. Off until switched on. */
export function useShowPrices(): boolean {
  return useSyncExternalStore(subscribe, read, readOnServer) === "1";
}

export function PriceToggle({ className }: { className?: string }) {
  const showing = useShowPrices();

  return (
    <button
      type="button"
      onClick={() => write(!showing)}
      aria-pressed={showing}
      title={showing ? "Hide prices" : "Show prices"}
      className={cx(
        "rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors",
        showing ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-surface-muted",
        className,
      )}
    >
      $ Prices
    </button>
  );
}

/**
 * A price, shown only when prices are switched on.
 *
 * Renders nothing at all when they are off, rather than an empty slot, so a
 * list with prices hidden looks like a list that never had them.
 */
export function Price({
  value,
  className,
  title,
}: {
  value: number | null;
  className?: string;
  title?: string;
}) {
  const showing = useShowPrices();
  if (!showing) return null;

  return (
    <span
      className={cx("shrink-0 tabular-nums", value === null ? "text-ink-muted" : "", className)}
      title={title ?? (value === null ? "No recent sale for this finish" : undefined)}
    >
      {value === null
        ? "—"
        : new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: value >= 1000 ? 0 : 2,
          }).format(value)}
    </span>
  );
}
