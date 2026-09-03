"use client";

import { useActionState, useEffect, useState } from "react";

import { updateDeckDetails } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { ManaSymbol } from "@/components/ManaCost";
import { Price, useShowPrices } from "@/components/PriceToggle";
import { Badge, Banner, Button, Input, cx } from "@/components/ui";
import type { CurveBucket, DeckStats } from "@/lib/collection/deck-stats";
import type { DeckSection } from "@/lib/collection/deck-view";
import { DECK_ARCHETYPES, DECK_FORMATS, type Location } from "@/lib/types";

/**
 * A deck's Details section: what it is (name, format, archetype tags, notes)
 * and what it looks like (price by section, mana curve by card type, colour
 * spread). Everything but the name is editable in place.
 */
export function DeckDetails({
  deck,
  stats,
  hasCards,
}: {
  deck: Location;
  stats: DeckStats;
  hasCards: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          Details
          <span aria-hidden="true" className="text-ink-muted">
            {open ? "▾" : "▸"}
          </span>
        </button>

        {open && !editing ? (
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        ) : null}
      </div>

      {!open ? null : editing ? (
        <DeckDetailsForm deck={deck} onDone={() => setEditing(false)} />
      ) : (
        <DeckDetailsView deck={deck} stats={stats} hasCards={hasCards} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Read view
// ---------------------------------------------------------------------------

function DeckDetailsView({
  deck,
  stats,
  hasCards,
}: {
  deck: Location;
  stats: DeckStats;
  hasCards: boolean;
}) {
  const showPrices = useShowPrices();
  // Tolerate a database where migration 21 has not run yet.
  const tags = deck.tags ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-xs text-ink-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          {deck.format ? <Badge>{deck.format}</Badge> : null}
          {tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
          {!deck.format && tags.length === 0 ? <span>No format or tags yet.</span> : null}
        </div>
        <p>
          Created {formatDate(deck.created_at)} · Updated {formatDate(deck.updated_at)}
        </p>
      </div>

      {deck.notes ? (
        <p className="whitespace-pre-line rounded-md bg-surface-muted px-3 py-2 text-sm">
          {deck.notes}
        </p>
      ) : null}

      {hasCards ? (
        <>
          {showPrices ? <PriceBreakdown stats={stats} /> : null}
          <ManaCurve curve={stats.curve} />
          <ColorSpread stats={stats} />
        </>
      ) : null}
    </div>
  );
}

function PriceBreakdown({ stats }: { stats: DeckStats }) {
  const { price } = stats;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold">Price</h3>
        {price.unpriced > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {price.priced} of {price.priced + price.unpriced} cards priced
          </span>
        ) : null}
      </div>

      <dl className="space-y-1 text-xs">
        {price.sections.map((s) => (
          <div key={s.section} className="flex items-center justify-between gap-2">
            <dt className="text-ink-muted">
              {s.label}{" "}
              <span className="tabular-nums">
                ({s.cards})
              </span>
            </dt>
            <dd>
              <Price value={s.priced > 0 ? s.total : null} />
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-1 font-semibold">
          <dt>Deck total ({price.cards})</dt>
          <dd>
            <Price value={price.total} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mana curve
// ---------------------------------------------------------------------------

/** Fixed, non-themed tones — one per card type, so a bar reads at a glance. */
const SECTION_TONE: Record<DeckSection, string> = {
  commander: "bg-amber-400",
  planeswalkers: "bg-pink-400",
  creatures: "bg-emerald-500",
  sorceries: "bg-violet-400",
  instants: "bg-sky-400",
  artifacts: "bg-zinc-400",
  enchantments: "bg-yellow-300",
  battles: "bg-orange-400",
  lands: "bg-lime-600",
  other: "bg-slate-400",
};

const BAR_MAX_PX = 120;

function ManaCurve({ curve }: { curve: CurveBucket[] }) {
  const peak = Math.max(1, ...curve.map((b) => b.total));
  const total = curve.reduce((sum, b) => sum + b.total, 0);

  // The card types actually present, for the legend.
  const legend: DeckSection[] = [];
  for (const b of curve) {
    for (const seg of b.segments) {
      if (!legend.includes(seg.section)) legend.push(seg.section);
    }
  }

  if (total === 0) {
    return (
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold">Mana curve</h3>
        <p className="text-xs text-ink-muted">No non-land cards on the list yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Mana curve</h3>

      <div className="flex items-end gap-1.5">
        {curve.map((b) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-ink-muted">{b.total || ""}</span>
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t bg-surface-muted"
              style={{ height: b.total > 0 ? Math.max(3, (b.total / peak) * BAR_MAX_PX) : 2 }}
            >
              {b.segments.map((seg) => (
                <div
                  key={seg.section}
                  className={SECTION_TONE[seg.section]}
                  style={{ flexGrow: seg.count, flexBasis: 0 }}
                  title={`${seg.count} ${seg.label} at ${b.label} mana`}
                />
              ))}
            </div>
            <span className="text-[10px] tabular-nums text-ink-muted">{b.label}</span>
          </div>
        ))}
      </div>

      {legend.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          {legend.map((section) => (
            <span key={section} className="flex items-center gap-1">
              <span className={cx("size-2.5 rounded-sm", SECTION_TONE[section])} />
              {sectionLabel(curve, section)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Pull a section's display label out of whichever bucket carries it. */
function sectionLabel(curve: CurveBucket[], section: DeckSection): string {
  for (const b of curve) {
    const seg = b.segments.find((s) => s.section === section);
    if (seg) return seg.label;
  }
  return section;
}

// ---------------------------------------------------------------------------
// Colour spread
// ---------------------------------------------------------------------------

function ColorSpread({ stats }: { stats: DeckStats }) {
  const { colors } = stats;
  if (colors.length === 0) return null;
  const peak = Math.max(1, ...colors.map((c) => c.count));

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Colors</h3>
      <p className="text-[11px] text-ink-muted">
        Cards by color identity — a multicolor card counts under each of its colors.
      </p>
      <div className="space-y-1">
        {colors.map((c) => (
          <div key={c.code} className="flex items-center gap-2 text-xs">
            <span className="flex w-20 items-center gap-1 text-ink-muted">
              <ManaSymbol code={c.code} size="xs" />
              {c.label}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-surface-muted">
              <div
                className="h-full rounded bg-accent"
                style={{ width: `${(c.count / peak) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right tabular-nums">{c.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

function DeckDetailsForm({ deck, onDone }: { deck: Location; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateDeckDetails, EMPTY_DECK_STATE);
  const [tags, setTags] = useState<string[]>(deck.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    if (state.nonce && !state.error) onDone();
  }, [state, onDone]);

  function addTag(raw: string) {
    const value = raw.trim().slice(0, 40);
    if (!value) return;
    setTags((prev) => (prev.some((t) => t.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value].slice(0, 20)));
    setTagDraft("");
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="deck_id" value={deck.id} />
      <input type="hidden" name="tags" value={tags.join("\n")} />

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">Name</span>
        <Input name="name" defaultValue={deck.name} maxLength={80} required className="max-w-sm" />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">Format</span>
        <Input
          name="format"
          defaultValue={deck.format ?? ""}
          list="deck-formats"
          maxLength={40}
          placeholder="Commander, Modern, …"
          className="max-w-xs"
        />
        <datalist id="deck-formats">
          {DECK_FORMATS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>

      <div className="space-y-1">
        <span className="text-xs font-medium text-ink-muted">Archetype tags</span>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  aria-label={`Remove ${tag}`}
                  className="text-ink-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(tagDraft);
              }
            }}
            list="deck-archetypes"
            placeholder="Add a tag"
            maxLength={40}
            className="max-w-xs"
          />
          <Button type="button" variant="secondary" className="text-xs" onClick={() => addTag(tagDraft)}>
            Add
          </Button>
        </div>
        <datalist id="deck-archetypes">
          {DECK_ARCHETYPES.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">Notes</span>
        <textarea
          name="notes"
          defaultValue={deck.notes ?? ""}
          rows={5}
          maxLength={5000}
          placeholder="Game plan, swaps to try, sideboard notes…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-ink-muted"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="text-xs">
          {pending ? "Saving…" : "Save details"}
        </Button>
        <Button type="button" variant="ghost" className="text-xs" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <Banner kind="error">{state.error}</Banner>
    </form>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
