"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

/**
 * An "Export" dropdown: copy or download a decklist, or download a CSV, all
 * computed server-side (src/lib/collection/export.ts is pure and has no DOM
 * dependency, so it runs on the page, not here).
 *
 * Generated client-side from a Blob rather than a route handler: both pages
 * this is used from already have the rows in hand by the time they render,
 * so shipping a second request to re-fetch and re-serialise them server-side
 * would just be slower for the same result.
 */
export function ExportButtons({
  decklistText,
  csv,
  filenameBase,
}: {
  decklistText: string;
  csv: string;
  /** Used for the downloaded filename, without an extension. */
  filenameBase: string;
}) {
  const [open, setOpen] = useState(false);
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

  async function copyDecklist() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(decklistText);
      setStatus({ kind: "copied" });
    } catch {
      // Most commonly an insecure origin (plain http, not localhost) or a
      // permission the browser refused. Either way, say so rather than
      // leaving the click looking like it did nothing.
      setStatus({ kind: "error" });
    }
  }

  function download(text: string, extension: "txt" | "csv") {
    const blob = new Blob([text], {
      type: extension === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameBase}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted";

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
          <button type="button" role="menuitem" className={itemClass} onClick={copyDecklist}>
            Copy decklist
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => download(decklistText, "txt")}
          >
            Download decklist (.txt)
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => download(csv, "csv")}
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
                : "Couldn’t copy — your browser blocked clipboard access. Try a download instead."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
