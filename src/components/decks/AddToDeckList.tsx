"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addDeckCard } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { DeckImportPanel } from "@/components/decks/DeckImportPanel";
import { Banner, Button, Card as Panel, Input, Select, cx } from "@/components/ui";
import type { CardNameSuggestion } from "@/lib/types";

/**
 * Adding a card to the decklist.
 *
 * Searches the whole card database, not the collection: a decklist is what you
 * intend the deck to be, so a card you have never owned has to be addable.
 * Whether you own it shows up afterwards, as the entry's state.
 */
export function AddToDeckList({ deckId }: { deckId: string }) {
  const [mode, setMode] = useState<"search" | "import">("search");
  const [state, add, adding] = useActionState(addDeckCard, EMPTY_DECK_STATE);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardNameSuggestion[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [searching, setSearching] = useState(false);

  // Debounced so typing does not fire a request per keystroke, and aborted so a
  // slow answer for an old query cannot overwrite a fast one for the current.
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = query.trim();
    // No setState here: what is shown is derived below instead. Clearing state
    // synchronously inside an effect is the cascading-render pattern React now
    // warns about, and deriving it needs no state at all.
    if (term.length < 2) return;

    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setSearching(true);
      try {
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        setResults(response.ok ? ((body.results ?? []) as CardNameSuggestion[]) : []);
      } catch {
        /* Aborted or offline: leave the previous results alone. */
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // A short query shows nothing, without having to empty the state that holds
  // the last real answer.
  const shown = query.trim().length < 2 ? [] : results;

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Add to the list</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Any card, whether or not you own it. What you own decides the state it shows in,
            not whether it can be on the list.
          </p>
        </div>

        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
          {(["search", "import"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cx(
                "px-2.5 py-1.5 text-xs font-medium transition-colors",
                mode === option ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
              )}
            >
              {option === "search" ? "Search" : "Import a list"}
            </button>
          ))}
        </div>
      </div>

      {mode === "import" ? (
        <DeckImportPanel deckId={deckId} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Card name"
              aria-label="Search for a card"
              className="max-w-xs"
            />
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              Quantity
              <Select
                value={String(quantity)}
                onChange={(e) => setQuantity(Number(e.target.value))}
                aria-label="How many to add"
                className="w-16 text-xs"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <Banner kind="error">{state.error}</Banner>
          <Banner kind="success">{state.notice}</Banner>

          {query.trim().length >= 2 ? (
            shown.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {searching ? "Searching…" : "No cards match that."}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {shown.map((result) => (
                  <li key={result.sample_card_id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{result.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-muted">
                      {result.printing_count} printing{result.printing_count === 1 ? "" : "s"}
                    </span>

                    <form action={add}>
                      <input type="hidden" name="deck_id" value={deckId} />
                      {/* The search returns one representative printing per name,
                          which is all a list entry needs — any printing satisfies it. */}
                      <input type="hidden" name="card_id" value={result.sample_card_id} />
                      <input type="hidden" name="quantity" value={quantity} />
                      <Button type="submit" variant="secondary" disabled={adding} className="text-xs">
                        Add {quantity}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      )}
    </Panel>
  );
}
