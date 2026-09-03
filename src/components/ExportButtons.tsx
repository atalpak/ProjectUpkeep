"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Copy-to-clipboard and download, for a decklist and a CSV that were already
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
  description,
}: {
  decklistText: string;
  csv: string;
  /** Used for the downloaded filename, without an extension. */
  filenameBase: string;
  /** What exactly this exports — the current filtered view, or the whole deck. */
  description?: string;
}) {
  const [status, setStatus] = useState<
    | { kind: "copied"; which: "decklist" | "csv" }
    | { kind: "error"; which: "decklist" | "csv" }
    | null
  >(null);

  async function copy(text: string, which: "decklist" | "csv") {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setStatus({ kind: "copied", which });
    } catch {
      // Most commonly an insecure origin (plain http, not localhost) or a
      // permission the browser refused. Either way, say so rather than
      // leaving the click looking like it did nothing.
      setStatus({ kind: "error", which });
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
  }

  return (
    <div className="space-y-1.5">
      {description ? <p className="text-xs text-ink-muted">{description}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => copy(decklistText, "decklist")}
          className="text-xs"
        >
          Copy decklist
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => download(decklistText, "txt")}
          className="text-xs"
        >
          Download decklist (.txt)
        </Button>
        <Button type="button" variant="secondary" onClick={() => copy(csv, "csv")} className="text-xs">
          Copy CSV
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => download(csv, "csv")}
          className="text-xs"
        >
          Download CSV (.csv)
        </Button>

        <span role="status" className="text-xs">
          {status?.kind === "copied" ? (
            <span className="text-ink-muted">
              {status.which === "decklist" ? "Decklist" : "CSV"} copied.
            </span>
          ) : status?.kind === "error" ? (
            <span className="text-danger">
              Couldn&rsquo;t copy — your browser blocked clipboard access. Try the download
              button instead.
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
