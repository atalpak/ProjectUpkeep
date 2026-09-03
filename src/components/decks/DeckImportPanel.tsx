"use client";

import Image from "next/image";
import { useActionState, useRef, useState } from "react";

import { previewDeckImport, runDeckImport } from "@/app/(app)/decks/import/actions";
import {
  EMPTY_DECK_IMPORT_STATE,
  type DeckImportState,
} from "@/app/(app)/decks/import/deck-import-state";
import { MAX_INPUT_BYTES } from "@/app/(app)/collection/import/action-state";
import { CardPreviewTarget } from "@/components/CardPanel";
import { SetSymbol } from "@/components/SetSymbol";
import { Banner, Button, Card as Panel, cx } from "@/components/ui";

const PLACEHOLDER = `1 Atraxa, Grand Unifier
1 Sol Ring
10 Forest
1 Cyclonic Rift (MH2) 63

…or paste a CSV export from Moxfield, Archidekt, ManaBox or Deckbox.`;

/**
 * Import a whole list into a deck at once — paste it, or read it from a file.
 *
 * A decklist carries no finish, condition, language or location, so unlike the
 * collection importer there is nothing to configure: paste, optionally Preview,
 * then Add. Quantities are added on top of whatever the deck already lists.
 */
export function DeckImportPanel({ deckId }: { deckId: string }) {
  const [state, preview, previewing] = useActionState<DeckImportState, FormData>(
    previewDeckImport,
    EMPTY_DECK_IMPORT_STATE,
  );
  const [commitState, commit, committing] = useActionState<DeckImportState, FormData>(
    runDeckImport,
    EMPTY_DECK_IMPORT_STATE,
  );

  const [lastAction, setLastAction] = useState<"preview" | "commit">("preview");
  const current = lastAction === "commit" ? commitState : state;
  const busy = previewing || committing;

  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // "The last thing that ran was a successful import" — what stops one extra
  // click adding every card a second time. Editing the list clears it.
  const committed = lastAction === "commit" && Boolean(commitState.notice) && !commitState.error;

  function rearm() {
    setLastAction("preview");
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_INPUT_BYTES) {
      setFileError(
        `${file.name} is ${(file.size / 1_000_000).toFixed(1)}MB, over the ${Math.round(
          MAX_INPUT_BYTES / 1_000_000,
        )}MB limit.`,
      );
      return;
    }

    const text = await file.text();
    setFileError(null);
    setFileName(file.name);
    setSource(text);
    rearm();
  }

  function clearFile() {
    setFileName(null);
    setFileError(null);
    setSource("");
    if (fileInput.current) fileInput.current.value = "";
    rearm();
  }

  return (
    <form className="space-y-4">
      <input type="hidden" name="deck_id" value={deckId} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          Any card, owned or not. Quantities add on top of what the list already has.
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={onFile}
            className="hidden"
            id={`deck-import-file-${deckId}`}
          />
          <label
            htmlFor={`deck-import-file-${deckId}`}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-muted"
          >
            Choose a file
          </label>
          {fileName ? (
            <button type="button" onClick={clearFile} className="text-xs text-ink-muted underline">
              Clear {fileName}
            </button>
          ) : null}
        </div>
      </div>

      <Banner kind="error">{fileError}</Banner>

      <textarea
        name="source"
        rows={8}
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          if (fileName) setFileName(null);
          rearm();
        }}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        aria-label="Paste a decklist or CSV"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs placeholder:text-ink-muted"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="secondary"
          formAction={preview}
          disabled={busy || source.trim() === ""}
          onClick={() => setLastAction("preview")}
          className="text-xs"
        >
          {previewing ? "Checking…" : "Preview"}
        </Button>

        <Button
          type="submit"
          formAction={commit}
          disabled={busy || committed || source.trim() === ""}
          onClick={() => setLastAction("commit")}
          className="text-xs"
        >
          {committing
            ? "Adding…"
            : state.preview
              ? `Add ${state.preview.totalCards} card${state.preview.totalCards === 1 ? "" : "s"}`
              : "Add to list"}
        </Button>

        {committed ? (
          <span className="text-xs text-ink-muted">
            Added. Change the list above to import again.
          </span>
        ) : null}
      </div>

      <Banner kind="error">{current.error}</Banner>
      <Banner kind="success">{current.notice}</Banner>

      {current.preview ? <DeckImportPreview preview={current.preview} committed={committed} /> : null}
    </form>
  );
}

function DeckImportPreview({
  preview,
  committed,
}: {
  preview: NonNullable<DeckImportState["preview"]>;
  committed: boolean;
}) {
  const needsLook = preview.skipped.length + preview.problems.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary
          label="Read as"
          value={preview.format === "csv" ? "Spreadsheet" : preview.format === "text" ? "Decklist" : "—"}
        />
        <Summary label={committed ? "Cards added" : "Cards to add"} value={preview.totalCards} />
        <Summary label="Entries" value={`${preview.newEntries} new · ${preview.mergedEntries} merged`} />
        <Summary label="Needs a look" value={needsLook} />
      </div>

      {!committed && preview.mergedEntries > 0 ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-ink">
          <span className="font-semibold">
            {preview.mergedEntries} of these already on the list
          </span>{" "}
          will have their quantity increased, not replaced.
        </div>
      ) : null}

      {preview.problems.length > 0 ? (
        <IssueList
          title={`${preview.problems.length} line(s) could not be read`}
          issues={preview.problems}
        />
      ) : null}

      {preview.skipped.length > 0 ? (
        <IssueList
          title={`${preview.skipped.length} line(s) matched no card${
            committed ? " and were not added" : ""
          }`}
          issues={preview.skipped}
        />
      ) : null}

      {preview.rows.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {committed ? "What was added" : "What will be added"}
          </h3>

          <Panel className="max-h-80 divide-y divide-border overflow-y-auto p-0">
            {preview.rows.map((row) => (
              <div key={`${row.line}-${row.cardId}`} className="flex items-center gap-3 px-3 py-2">
                <CardPreviewTarget
                  card={row.cardId}
                  className="relative h-11 w-8 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
                >
                  {row.imageUri ? (
                    <Image
                      src={row.imageUri}
                      alt=""
                      fill
                      sizes="32px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : null}
                </CardPreviewTarget>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{row.quantity}×</span>
                  {row.setCode ? <SetSymbol code={row.setCode} size={12} /> : null}
                  <span className="truncate text-sm">{row.matched ?? row.name}</span>
                </div>

                <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
                  line {row.line}
                </span>
              </div>
            ))}
          </Panel>

          {preview.rowsTruncated ? (
            <p className="text-xs text-ink-muted">
              Showing the first {preview.rows.length} of {preview.matchedRows} matched entries.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-muted">{label}</div>
    </div>
  );
}

function IssueList({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ line: number; raw: string; reason: string }>;
}) {
  const shown = issues.slice(0, 50);

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{title}</summary>
      <ul className={cx("divide-y divide-border border-t border-border text-xs")}>
        {shown.map((issue) => (
          <li key={`${issue.line}-${issue.raw}`} className="px-3 py-2">
            <span className="tabular-nums text-ink-muted">line {issue.line}</span>{" "}
            <span className="font-mono">{issue.raw.slice(0, 120)}</span>
            <div className="mt-0.5 text-ink-muted">{issue.reason}</div>
          </li>
        ))}
        {issues.length > shown.length ? (
          <li className="px-3 py-2 text-ink-muted">…and {issues.length - shown.length} more.</li>
        ) : null}
      </ul>
    </details>
  );
}
