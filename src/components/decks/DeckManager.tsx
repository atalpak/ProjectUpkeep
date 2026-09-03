"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { createDeck, deleteDeck } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input } from "@/components/ui";
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
        <Panel className="divide-y divide-border p-0">
          {decks.map((deck) => {
            const tags = deck.tags ?? [];
            return (
              <div key={deck.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/decks/${deck.id}`} className="font-medium hover:underline">
                    {deck.name}
                  </Link>

                  <p className="text-xs text-ink-muted">
                    {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"} ({deck.uniqueCount}{" "}
                    unique)
                    {deck.commanderName ? <> · {deck.commanderName}</> : null}
                  </p>

                  {deck.format || tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {deck.format ? <Badge>{deck.format}</Badge> : null}
                      {tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  ) : null}

                  {deck.notes ? (
                    <p className="line-clamp-2 text-xs text-ink-muted">{deck.notes}</p>
                  ) : null}
                </div>

                <DeleteDeckButton deckId={deck.id} deckName={deck.name} />
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}

/**
 * Delete, behind one confirmation click.
 *
 * Deleting a deck unsorts its cards rather than destroying them, so this is
 * reversible in substance — but a stray click still loses the list and any
 * commander nomination, which is annoying enough to guard.
 */
function DeleteDeckButton({ deckId, deckName }: { deckId: string; deckName: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        variant="danger"
        type="button"
        onClick={() => setArmed(true)}
        className="shrink-0 text-xs"
      >
        Delete
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="hidden text-xs text-ink-muted sm:inline">Delete “{deckName}”?</span>
      <form action={deleteDeck}>
        <input type="hidden" name="deck_id" value={deckId} />
        <Button variant="danger" type="submit" className="text-xs">
          Delete
        </Button>
      </form>
      <Button
        variant="ghost"
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs"
      >
        Cancel
      </Button>
    </div>
  );
}
