"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";

import { checkList, saveAsDeck } from "@/app/(app)/decks/check/actions";
import {
  EMPTY_LIST_CHECK_STATE,
  EMPTY_SAVE_DECK_STATE,
  type CheckRow,
  type ListCheckResult,
  type ListCheckState,
  type SaveDeckState,
} from "@/app/(app)/decks/check/check-state";
import { MAX_INPUT_BYTES } from "@/app/(app)/collection/import/action-state";
import { groupDeck } from "@/lib/collection/deck-view";
import { describeElsewhere, describeSpare } from "@/lib/collection/list-check";
import { cardDisplayName } from "@/lib/types";
import { CardPreviewTarget } from "@/components/CardPanel";
import { ManaCost } from "@/components/ManaCost";
import { Price, PriceToggle } from "@/components/PriceToggle";
import { SetSymbol } from "@/components/SetSymbol";
import { ListCheckMark } from "@/components/decks/DeckStateMark";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, cx } from "@/components/ui";

const PLACEHOLDER = `1 Atraxa, Grand Unifier
1 Sol Ring
1 Cyclonic Rift
10 Forest

…or paste a Moxfield / Archidekt / ManaBox export.`;

/**
 * "Could I build this right now?"
 *
 * Paste a list from anywhere and see it reconciled against the collection —
 * without creating a deck. That last part is the point: browsing five decks on a
 * Sunday should not leave five junk decks behind, so nothing here writes until
 * you press Save as deck.
 *
 * The heavy lifting is all borrowed. Parsing, printing resolution and
 * availability are the same code the importer and the deck page use; what this
 * screen adds is running them and stopping.
 */
export function ListCheck() {
  const [state, check, checking] = useActionState<ListCheckState, FormData>(
    checkList,
    EMPTY_LIST_CHECK_STATE,
  );

  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The text the result on screen was computed from. Editing the box after a
  // check makes the numbers below stale, and silently saving the *new* text as
  // a deck you never checked would be the worst version of that.
  const [checkedSource, setCheckedSource] = useState("");
  const stale = Boolean(state.result) && source !== checkedSource;

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

    setFileError(null);
    setFileName(file.name);
    setSource(await file.text());
  }

  function clearFile() {
    setFileName(null);
    setFileError(null);
    setSource("");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="space-y-5">
      <form action={check} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">
            Nothing is saved. Check as many lists as you like.
          </p>

          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={onFile}
              className="hidden"
              id="list-check-file"
            />
            <label
              htmlFor="list-check-file"
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
          rows={10}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            if (fileName) setFileName(null);
          }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label="Paste a decklist"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs placeholder:text-ink-muted"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={checking || source.trim() === ""}
            onClick={() => setCheckedSource(source)}
          >
            {checking ? "Checking…" : "Check this list"}
          </Button>

          {stale ? (
            <span className="text-xs text-ink-muted">
              You have changed the list — check it again.
            </span>
          ) : null}
        </div>
      </form>

      <Banner kind="error">{state.error}</Banner>

      {state.result ? (
        <CheckResult result={state.result} source={checkedSource} stale={stale} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

type Filter = "all" | "attention";

function CheckResult({
  result,
  source,
  stale,
}: {
  result: ListCheckResult;
  source: string;
  stale: boolean;
}) {
  const { summary, rows } = result;
  const [filter, setFilter] = useState<Filter>("all");

  const attention = summary.elsewhereEntries + summary.missingEntries;
  const shown = filter === "attention" ? rows.filter((r) => r.state !== "ready") : rows;

  // Grouped by card type, like a decklist is read everywhere else in the app.
  const groups = useMemo(
    () =>
      groupDeck(
        shown.map((row) => ({ id: row.key, quantity: row.wanted, cards: row.card, row })),
        "name",
      ),
    [shown],
  );

  return (
    <div className="space-y-5">
      <Verdict result={result} />

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
              All {summary.entries}
            </FilterTab>
            <FilterTab
              active={filter === "attention"}
              onClick={() => setFilter("attention")}
              disabled={attention === 0}
            >
              Needs a decision {attention}
            </FilterTab>
          </div>

          <PriceToggle />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState title="Nothing here needs a decision.">
          <p>Every card on this list is sitting free in your collection.</p>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.section} className="space-y-1">
              <h2 className="flex items-baseline gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.label}
                <span className="font-normal normal-case tabular-nums">{group.cardCount}</span>
              </h2>
              <Panel className="divide-y divide-border p-0">
                {group.rows.map((entry) => (
                  <Row key={entry.id} row={entry.row} />
                ))}
              </Panel>
            </section>
          ))}
        </div>
      )}

      <Unread title="Lines that matched no card" issues={result.skipped} />
      <Unread title="Lines that could not be read" issues={result.problems} />

      <SaveAsDeck source={source} stale={stale} cards={summary.wanted} />
    </div>
  );
}

function FilterTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cx(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40",
        active
          ? "border-accent bg-accent-soft text-ink"
          : "border-border text-ink-muted hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The headline, and the one screen element the whole feature exists for.
 *
 * A sentence first, because that is what gets read; then a bar showing how the
 * list splits three ways, because "94 of 100" hides whether the other six are a
 * shopping trip or a walk to the shelf.
 */
function Verdict({ result }: { result: ListCheckResult }) {
  const { summary } = result;
  const { wanted, free, inDecks, missing } = summary;

  const headline = summary.buildable
    ? "You can build this right now."
    : missing === 0
      ? "You own every card — but some are in other decks."
      : `${missing} card${missing === 1 ? "" : "s"} short.`;

  const pct = (n: number) => (wanted > 0 ? (n / wanted) * 100 : 0);

  return (
    <Panel className="space-y-3 bg-surface-raised">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-display text-lg font-semibold tracking-tight">{headline}</p>
        <p className="text-xs text-ink-muted tabular-nums">
          {summary.entries} card{summary.entries === 1 ? "" : "s"} · {wanted} total
        </p>
      </div>

      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
        role="img"
        aria-label={`${free} free, ${inDecks} in other decks, ${missing} not owned, of ${wanted}`}
      >
        {free > 0 ? <span className="bg-[#1f7a4d]" style={{ width: `${pct(free)}%` }} /> : null}
        {inDecks > 0 ? (
          <span className="bg-[#b8862b]" style={{ width: `${pct(inDecks)}%` }} />
        ) : null}
        {missing > 0 ? (
          <span className="bg-[#8a2f2f]" style={{ width: `${pct(missing)}%` }} />
        ) : null}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Leg tone="#1f7a4d" value={free} label="free in your collection" />
        <Leg tone="#b8862b" value={inDecks} label="sleeved in other decks" />
        <Leg tone="#8a2f2f" value={missing} label="you do not own" />
      </dl>
    </Panel>
  );
}

function Leg({ tone, value, label }: { tone: string; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2 py-2">
      <dt className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-ink-muted">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: tone }}
        />
        {label}
      </dt>
      <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Where this entry's copies would come from, in words. */
function origin(row: CheckRow): string {
  const parts = [
    describeSpare(row.fromFree, row.spareIn),
    describeElsewhere(row.fromDecks, row.elsewhereDecks),
    row.short > 0 ? `${row.short} to find` : null,
  ].filter(Boolean);

  return parts.join(" · ");
}

/** Full detail for the origin line's tooltip — the truncated text above it
 *  names at most one container and collapses multiple decks to a count, so
 *  hovering is how the rest is read. */
function originTitle(row: CheckRow): string | undefined {
  const parts = [
    row.spareIn.length > 0 ? `Free in: ${row.spareIn.join(", ")}` : null,
    row.elsewhereDecks.length > 0 ? `Sleeved in: ${row.elsewhereDecks.join(", ")}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function Row({ row }: { row: CheckRow }) {
  const card = row.card;
  const name = cardDisplayName(card);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <ListCheckMark entry={row} />

      <span className="w-7 shrink-0 text-right text-sm tabular-nums text-ink-muted">
        {row.wanted}×
      </span>

      {card.image_uri_small ? (
        <Image
          src={card.image_uri_small}
          alt=""
          width={30}
          height={42}
          className="hidden shrink-0 rounded sm:block"
          unoptimized
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <CardPreviewTarget card={card.scryfall_id} className="block truncate text-sm font-medium">
          {name}
        </CardPreviewTarget>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <SetSymbol code={card.set_code} />
          <span className="truncate" title={originTitle(row)}>
            {origin(row)}
          </span>
        </div>

        {/* Not owned: what it would cost, and who in the circle already has
            it open for trade — the most useful line on this whole screen. */}
        {row.short > 0 && (card.price_usd !== null || row.friendSupply.length > 0) ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Price value={card.price_usd} className="text-ink-muted" />
            {row.friendSupply.length > 0 ? (
              <Badge>
                {row.friendSupply[0].username} has {row.friendSupply[0].available}
                {row.friendSupply[0].locations[0] ? ` in ${row.friendSupply[0].locations[0]}` : ""}
                {row.friendSupply.length > 1 ? ` +${row.friendSupply.length - 1} more` : ""}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Wrapped, not given `hidden sm:flex` directly: ManaCost sets its own
          `inline-flex`, and two display utilities in one layer are settled by
          stylesheet order rather than class-attribute order — so `hidden`
          lost and this showed below `sm` too, eating width from the
          truncating name column beside it. Same cascade quirk as the header's
          ThemeToggle. */}
      <span className="hidden shrink-0 sm:inline-flex">
        <ManaCost cost={card.mana_cost} size="xs" />
      </span>
    </div>
  );
}

function Unread({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ line: number; raw: string; reason: string }>;
}) {
  if (issues.length === 0) return null;

  return (
    <details className="rounded-xl border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {title} <span className="text-ink-muted">({issues.length})</span>
      </summary>
      <ul className="mt-2 space-y-1 text-xs text-ink-muted">
        {issues.map((issue) => (
          <li key={`${issue.line}-${issue.raw}`}>
            <span className="tabular-nums">Line {issue.line}:</span>{" "}
            <span className="font-mono">{issue.raw}</span> — {issue.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Committing to it after all
// ---------------------------------------------------------------------------

function SaveAsDeck({
  source,
  stale,
  cards,
}: {
  source: string;
  stale: boolean;
  cards: number;
}) {
  const [state, save, saving] = useActionState<SaveDeckState, FormData>(
    saveAsDeck,
    EMPTY_SAVE_DECK_STATE,
  );

  if (state.deckId && !state.error) {
    return (
      <Panel className="space-y-2">
        <Banner kind="success">
          Saved “{state.deckName}” with {cards} card{cards === 1 ? "" : "s"} on its list.
        </Banner>
        <Link href={`/decks/${state.deckId}`} className="text-sm text-accent underline">
          Open the deck →
        </Link>
      </Panel>
    );
  }

  return (
    <Panel className="space-y-3">
      <div>
        <p className="font-display text-base font-semibold tracking-tight">Building it after all?</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          Save the list as a deck. This writes the decklist only — no cards move until you sleeve
          them.
        </p>
      </div>

      <form action={save} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="source" value={source} />
        <Input
          name="name"
          placeholder="Deck name"
          maxLength={80}
          required
          aria-label="Deck name"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={saving || stale}>
          {saving ? "Saving…" : "Save as deck"}
        </Button>
      </form>

      {stale ? (
        <p className="text-xs text-ink-muted">
          Check the list again before saving, so the deck matches what you just read.
        </p>
      ) : null}

      <Banner kind="error">{state.error}</Banner>
    </Panel>
  );
}
