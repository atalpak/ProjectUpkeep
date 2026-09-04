"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

/**
 * An "Export" dropdown: copy or download a decklist, or download a CSV, all
 * computed server-side (src/lib/collection/export.ts is pure and has no DOM
 * dependency, so it runs on the page, not here).
 *
 * Two sources, because the two callers differ in size:
 *
 *   - `inline` — the text is already computed and passed in. Right for a deck,
 *     which is a hundred rows the page has in hand anyway.
 *   - `remote` — fetched from /api/collection/export on click. Right for a
 *     collection, which can be thousands of rows: once the table is paginated
 *     the page no longer holds the rows to serialise, and the inlined text
 *     grows without bound with the collection.
 */
/** Where the exported text comes from. */
export type ExportSource =
  | { kind: "inline"; decklistText: string; csv: string }
  /** `href` takes a `format=csv|txt` query parameter. */
  | { kind: "remote"; href: string };

export function ExportButtons({
  source,
  filenameBase,
}: {
  source: ExportSource;
  /** Used for the downloaded filename, without an extension. */
  filenameBase: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    { kind: "copied" } | { kind: "error" } | null
  >(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    // A fresh open should not still be showing the last result.
    setStatus(null);
    setOpen((v) => !v);
  }

  /** The export text, however this instance is sourced. */
  async function textFor(extension: "txt" | "csv"): Promise<string> {
    if (source.kind === "inline") {
      return extension === "csv" ? source.csv : source.decklistText;
    }
    const separator = source.href.includes("?") ? "&" : "?";
    const response = await fetch(`${source.href}${separator}format=${extension}`);
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  }

  async function copyDecklist() {
    setBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(await textFor("txt"));
      setStatus({ kind: "copied" });
    } catch {
      // Most commonly an insecure origin (plain http, not localhost) or a
      // permission the browser refused. Either way, say so rather than
      // leaving the click looking like it did nothing.
      setStatus({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function download(extension: "txt" | "csv") {
    setBusy(true);
    try {
      const blob = new Blob([await textFor(extension)], {
        type: extension === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameBase}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setStatus({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted disabled:cursor-progress disabled:opacity-60";

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors",
          open ? "bg-surface-muted" : "bg-surface hover:bg-surface-muted",
        )}
      >
        Export
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        >
          <button type="button" role="menuitem" disabled={busy} className={itemClass} onClick={() => void copyDecklist()}>
            Copy decklist
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={itemClass}
            onClick={() => void download("txt")}
          >
            Download decklist (.txt)
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={itemClass}
            onClick={() => void download("csv")}
          >
            Download CSV (.csv)
          </button>

          {status ? (
            <p
              role="status"
              className={cx(
                "border-t border-border px-3 py-2 text-xs",
                status.kind === "copied" ? "text-ink-muted" : "text-danger",
              )}
            >
              {status.kind === "copied"
                ? "Decklist copied."
                : "Couldn’t export — the browser blocked clipboard access, or the request failed."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
