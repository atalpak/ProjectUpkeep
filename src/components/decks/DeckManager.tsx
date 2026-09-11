"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { createDeck, deleteDeck } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { ManaSymbol } from "@/components/ManaCost";
import { DeckFace } from "@/components/decks/DeckFace";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, cx } from "@/components/ui";
import type { DeckSummary } from "@/lib/collection/queries";

/** The deck list, plus the form for starting a new one. */
export function DeckManager({ decks }: { decks: DeckSummary[] }) {
  const [state, action, pending] = useActionState(createDeck, EMPTY_DECK_STATE);

  return (
    <div className="space-y-5">
      <Panel className="space-y-3">
        <h2 className="text-sm font-semibold">Start a deck</h2>
        {/* Keyed on the nonce so a successful create empties the box. */}
        <form key={state.nonce ?? "new"} action={action} className="flex flex-wrap gap-2">
          <Input
            name="name"
            placeholder="Mono-Red Aggro"
            maxLength={80}
            required
            className="max-w-xs"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create deck"}
          </Button>
        </form>

        <Banner kind="error">{state.error}</Banner>
        <Banner kind="success">{state.notice}</Banner>
      </Panel>

      {decks.length === 0 ? (
        <EmptyState title="No decks yet.">
          A deck is a real place a card can be. Create one, then add cards to it from your
          collection — those copies stop counting as available.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One deck, as a card with a face.
 *
 * The old row was a line of text with a Delete button as its loudest element —
 * the destructive action styled louder than the deck itself, and nothing on it
 * that another collection tool could not also print. Two changes fix both:
 *
 *   - The commander's art is the deck's face. In Commander the commander *is*
 *     the deck's identity, and a name in 12px grey asks the reader to picture
 *     it themselves.
 *   - The progress bar says how much of the list is actually in the box. That
 *     is the one number only this app can print, and it was the one number the
 *     row left out.
 *
 * Delete moves behind the ⋯ menu: still one click away, no longer the first
 * thing the eye lands on.
 */
function DeckCard({ deck }: { deck: DeckSummary }) {
  const tags = deck.tags ?? [];
  const complete = deck.cardCount > 0 && deck.sleevedCount >= deck.cardCount;
  const pct = deck.cardCount > 0 ? (deck.sleevedCount / deck.cardCount) * 100 : 0;

  return (
    <div className="relative flex gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-accent/50">
      <DeckFace image={deck.commanderImage} size="thumb" />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          {/* Stretched so the whole card is the target, not just the words —
              a deck is one thing to click, and the row is big now. */}
          <Link
            href={`/decks/${deck.id}`}
            className="font-display text-base font-semibold leading-tight tracking-tight before:absolute before:inset-0 before:content-['']"
          >
            {deck.name}
          </Link>

          {/* Above the stretched link so it stays clickable. */}
          <div className="relative z-10 shrink-0">
            <DeleteDeckButton deckId={deck.id} deckName={deck.name} />
          </div>
        </div>

        {deck.commanderColors.length > 0 ? (
          <div className="flex gap-0.5">
            {deck.commanderColors.map((code) => (
              <ManaSymbol key={code} code={code} size="xs" />
            ))}
          </div>
        ) : null}

        <p className="truncate text-xs text-ink-muted">
          {deck.commanderName ?? `${deck.uniqueCount} different cards`}
        </p>

        {deck.cardCount > 0 ? (
          <div className="space-y-1 pt-0.5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
              role="img"
              aria-label={`${deck.sleevedCount} of ${deck.cardCount} cards sleeved`}
            >
              <span
                className={cx("block h-full rounded-full", complete ? "bg-[#1f7a4d]" : "bg-accent")}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-ink-muted">
              {complete ? (
                <span className="font-medium text-ink">Ready to play</span>
              ) : (
                <>
                  <span className="font-medium text-ink">
                    {deck.sleevedCount} of {deck.cardCount}
                  </span>{" "}
                  sleeved
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Nothing on the list yet.</p>
        )}

        {deck.format || tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {deck.format ? <Badge>{deck.format}</Badge> : null}
            {tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Delete, behind one confirmation click.
 *
 * Deleting a deck unsorts its cards rather than destroying them, so this is
 * reversible in substance — but a stray click still loses the list and any
 * commander nomination, which is annoying enough to guard.
 *
 * Unarmed it is a quiet ⋯, not a red button. Destructive actions should be
 * reachable, not prominent, and a bordered "Delete" on every row made the
 * loudest thing on the decks page the one action nobody came to perform.
 * Arming it swaps in the full-strength confirmation, where the emphasis
 * belongs.
 */
function DeleteDeckButton({ deckId, deckName }: { deckId: string; deckName: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Delete ${deckName}`}
        title={`Delete ${deckName}`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <form action={deleteDeck}>
        <input type="hidden" name="deck_id" value={deckId} />
        <Button variant="danger" type="submit" className="text-xs">
          Delete
        </Button>
      </form>
      <Button variant="ghost" type="button" onClick={() => setArmed(false)} className="text-xs">
        Cancel
      </Button>
    </div>
  );
}
