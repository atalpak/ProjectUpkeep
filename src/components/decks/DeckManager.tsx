"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createDeck, deleteDeck } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { Banner, Button, Card as Panel, EmptyState, Input } from "@/components/ui";
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
          {decks.map((deck) => (
            <div key={deck.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/decks/${deck.id}`}
                  className="font-medium hover:underline"
                >
                  {deck.name}
                </Link>
                <p className="text-xs text-ink-muted">
                  {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"} in {deck.entryCount} entr
                  {deck.entryCount === 1 ? "y" : "ies"}
                </p>
              </div>

              {/* Deleting a deck unsorts its cards rather than destroying them,
                  so this needs no confirmation of its own. */}
              <form action={deleteDeck}>
                <input type="hidden" name="deck_id" value={deck.id} />
                <Button variant="danger" type="submit" className="text-xs">
                  Delete
                </Button>
              </form>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
