"use client";

import { useActionState, useEffect, useState } from "react";

import { updateDeckDetails } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { Badge, Banner, Button, Input } from "@/components/ui";
import { DECK_ARCHETYPES, DECK_FORMATS, type Location } from "@/lib/types";

/**
 * The deck's identity, sat under its name: format, archetype tags, a
 * description, and when it was last touched. Edit swaps the whole block for the
 * form. Everything analytical (price, curve, colours) lives elsewhere on the
 * page — this is just what the deck *is*.
 */
export function DeckHeaderMeta({ deck }: { deck: Location }) {
  const [editing, setEditing] = useState(false);
  const tags = deck.tags ?? [];

  if (editing) {
    return <DeckDetailsEditor deck={deck} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="space-y-2 text-sm text-ink-muted">
      <div className="flex flex-wrap items-center gap-1.5">
        {deck.format ? <Badge>{deck.format}</Badge> : null}
        {tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          {deck.format || tags.length > 0 ? "Edit details" : "Add format, tags, notes"}
        </button>
      </div>

      {deck.notes ? (
        <p className="max-w-2xl whitespace-pre-line text-sm text-ink">{deck.notes}</p>
      ) : null}

      <p className="text-xs">Updated {formatDate(deck.updated_at)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

export function DeckDetailsEditor({ deck, onDone }: { deck: Location; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateDeckDetails, EMPTY_DECK_STATE);
  const [tags, setTags] = useState<string[]>(deck.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    if (state.nonce && !state.error) onDone();
  }, [state, onDone]);

  function addTag(raw: string) {
    const value = raw.trim().slice(0, 40);
    if (!value) return;
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === value.toLowerCase())
        ? prev
        : [...prev, value].slice(0, 20),
    );
    setTagDraft("");
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-surface p-3"
    >
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
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={() => addTag(tagDraft)}
          >
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
