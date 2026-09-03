"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import { previewImport, runImport } from "@/app/(app)/collection/import/actions";
import {
  EMPTY_IMPORT_STATE,
  MAX_INPUT_BYTES,
  type ImportState,
} from "@/app/(app)/collection/import/action-state";
import { LocationSelect } from "@/components/LocationSelect";
import {
  CONDITIONS,
  CONDITION_LABELS,
  FINISHES,
  FINISH_LABELS,
  LANGUAGES,
  type Location,
} from "@/lib/types";
import { CardPreviewTarget } from "@/components/CardPanel";
import { SetSymbol } from "@/components/SetSymbol";
import { Badge, Banner, Button, Card as Panel, Field, Select, cx } from "@/components/ui";

const PLACEHOLDER = `4 Lightning Bolt
2 Counterspell (2X2) 117
1 Sol Ring (C21) 263 *F*

…or paste a CSV export from Moxfield, ManaBox, Archidekt or Deckbox.`;

export function ImportForm({ locations }: { locations: Location[] }) {
  // Two actions over one set of fields: preview writes nothing, import writes.
  // They share a state shape so the preview stays on screen after committing.
  const [state, preview, previewing] = useActionState<ImportState, FormData>(
    previewImport,
    EMPTY_IMPORT_STATE,
  );
  const [commitState, commit, committing] = useActionState<ImportState, FormData>(
    runImport,
    EMPTY_IMPORT_STATE,
  );

  // Whichever ran most recently is what the user is looking at.
  const [lastAction, setLastAction] = useState<"preview" | "commit">("preview");
  const current = lastAction === "commit" ? commitState : state;
  const busy = previewing || committing;

  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_INPUT_BYTES) {
      setFileError(
        `${file.name} is ${(file.size / 1_000_000).toFixed(1)}MB, over the ${Math.round(
          MAX_INPUT_BYTES / 1_000_000,
        )}MB limit. Split it into smaller files.`,
      );
      return;
    }

    // Read in the browser and drop the text into the same field a paste uses,
    // so the server only ever deals with one kind of input.
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

  /**
   * Let a changed list be imported again.
   *
   * `committed` is "the last thing that ran was a successful import", which is
   * what stops one click filing the same cards twice. Previewing used to be the
   * only way to clear it; now that previewing is optional, editing the list has
   * to clear it too — otherwise a first import would disable the button for
   * good. Done from the change handler rather than an effect.
   */
  function rearm() {
    setLastAction("preview");
  }

  const committed = lastAction === "commit" && Boolean(commitState.notice);

  return (
    <form className="space-y-6">
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">What to import</h2>

          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={onFile}
              className="hidden"
              id="import-file"
            />
            <label
              htmlFor="import-file"
              className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
            >
              Choose a file
            </label>
            {fileName ? (
              <button
                type="button"
                onClick={clearFile}
                className="text-xs text-ink-muted underline"
              >
                Clear {fileName}
              </button>
            ) : null}
          </div>
        </div>

        <Banner kind="error">{fileError}</Banner>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-muted">
            Paste a decklist or CSV
          </span>
          <textarea
            name="source"
            rows={10}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (fileName) setFileName(null);
              rearm();
            }}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs placeholder:text-ink-muted"
          />
        </label>
      </Panel>

      <Panel className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Where it goes, and what to assume</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Anything the file states wins. These fill the gaps — a plain decklist
            says nothing about condition or language.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Destination">
            <LocationSelect name="location_id" locations={locations} />
          </Field>

          <Field label="Condition">
            <Select name="default_condition" defaultValue="NM">
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Finish">
            <Select name="default_finish" defaultValue="nonfoil">
              {FINISHES.map((f) => (
                <option key={f} value={f}>
                  {FINISH_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Language">
            <Select name="default_language" defaultValue="en">
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          formAction={preview}
          disabled={busy || source.trim() === ""}
          onClick={() => setLastAction("preview")}
        >
          {previewing ? "Checking…" : "Preview"}
        </Button>

        {/* Previewing is an option, not a toll gate. Importing is safe to do
            directly: it reports exactly what it added and what it skipped, and
            anything filed wrongly can be moved or deleted afterwards.
            Still disabled once a commit has succeeded — the same text is in the
            box and a second click would file every card again. */}
        <Button
          type="submit"
          formAction={commit}
          disabled={busy || committed || source.trim() === ""}
          onClick={() => setLastAction("commit")}
        >
          {committing
            ? "Importing…"
            : state.preview
              ? `Import ${state.preview.totalCards} card${state.preview.totalCards === 1 ? "" : "s"}`
              : "Import"}
        </Button>

        {committed ? (
          <span className="text-xs text-ink-muted">
            Already imported. Change the list above to import again.
          </span>
        ) : null}
      </div>

      <Banner kind="error">{current.error}</Banner>
      <Banner kind="success">{current.notice}</Banner>

      {committed ? (
        <p className="text-sm">
          <Link href="/collection" className="text-accent underline">
            View your collection
          </Link>
        </p>
      ) : null}

      {current.preview ? <Preview preview={current.preview} committed={committed} /> : null}
    </form>
  );
}

function Preview({
  preview,
  committed,
}: {
  preview: NonNullable<ImportState["preview"]>;
  committed: boolean;
}) {
  const formatLabel =
    preview.format === "csv" ? "Spreadsheet export" : preview.format === "text" ? "Decklist" : "—";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Read as" value={formatLabel} />
        <Summary label={committed ? "Cards added" : "Cards to add"} value={preview.totalCards} />
        <Summary label="Entries affected" value={preview.stackCount} />
        <Summary
          label="Needs a look"
          value={preview.skipped.length + preview.problems.length + preview.warningCount}
        />
      </div>

      {!committed && preview.mergedEntries > 0 ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-ink">
          {preview.newEntries === 0 ? (
            <>
              <span className="font-semibold">Every entry here is already in your collection.</span>{" "}
              Importing <span className="font-semibold">adds these quantities on top</span> of what
              you have — it does not replace them. Re-importing a list you previously exported will
              double your counts.
            </>
          ) : (
            <>
              <span className="font-semibold">
                {preview.mergedEntries} of these {preview.stackCount} entries already exist
              </span>{" "}
              and will have their quantities increased; the other {preview.newEntries} will be added
              as new.
            </>
          )}
        </div>
      ) : null}

      {Object.keys(preview.mappedColumns).length > 0 ? (
        <p className="text-xs text-ink-muted">
          Columns used:{" "}
          {Object.entries(preview.mappedColumns).map(([field, column], i) => (
            <span key={field}>
              {i > 0 ? ", " : ""}
              <span className="text-ink">{column}</span> → {field}
            </span>
          ))}
        </p>
      ) : null}

      {preview.problems.length > 0 ? (
        <IssueList
          title={`${preview.problems.length} line(s) could not be read`}
          issues={preview.problems}
        />
      ) : null}

      {preview.skipped.length > 0 ? (
        <IssueList
          title={`${preview.skipped.length} line(s) matched no card${committed ? " and were not imported" : ""}`}
          issues={preview.skipped}
        />
      ) : null}

      {preview.rows.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {committed ? "What was imported" : "What will be imported"}
          </h3>

          <Panel className="divide-y divide-border p-0">
            {preview.rows.map((row) => (
              <div key={row.line} className="flex items-center gap-3 px-3 py-2">
                <CardPreviewTarget
                  card={row.cardId}
                  className="relative h-11 w-8 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
                >
                  {row.imageUri ? (
                    // unoptimized: Scryfall's CDN rejects the optimizer's
                    // server-side fetch. See the note in the dashboard.
                    <Image src={row.imageUri} alt="" fill sizes="32px" className="object-cover" unoptimized />
                  ) : null}
                </CardPreviewTarget>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">{row.quantity}×</span>
                    {row.setCode ? <SetSymbol code={row.setCode} size={12} /> : null}
                    <span className="truncate text-sm">{row.matched ?? row.name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge>{row.condition}</Badge>
                    <Badge>{row.finish}</Badge>
                    <Badge>{row.language}</Badge>
                    {row.warnings.map((w) => (
                      <span key={w} className="text-[11px] text-ink-muted">
                        {w}
                      </span>
                    ))}
                  </div>
                </div>

                <span className="shrink-0 text-[11px] text-ink-muted tabular-nums">
                  line {row.line}
                </span>
              </div>
            ))}
          </Panel>

          {preview.rowsTruncated ? (
            <p className="text-xs text-ink-muted">
              Showing the first {preview.rows.length} of {preview.matchedRows} matched lines.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2.5">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
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
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{title}</summary>
      <ul className={cx("divide-y divide-border border-t border-border text-xs")}>
        {shown.map((issue) => (
          <li key={`${issue.line}-${issue.raw}`} className="px-3 py-2">
            <span className="text-ink-muted tabular-nums">line {issue.line}</span>{" "}
            <span className="font-mono">{issue.raw.slice(0, 120)}</span>
            <div className="mt-0.5 text-ink-muted">{issue.reason}</div>
          </li>
        ))}
        {issues.length > shown.length ? (
          <li className="px-3 py-2 text-ink-muted">
            …and {issues.length - shown.length} more.
          </li>
        ) : null}
      </ul>
    </details>
  );
}
