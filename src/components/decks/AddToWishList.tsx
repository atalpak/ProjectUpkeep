"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addWant } from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { Banner, Button, Input, Select } from "@/components/ui";
import type { CardNameSuggestion } from "@/lib/types";

/**
 * Adding a card to this deck's wish list.
 *
 * Goes through the same name -> representative-printing path as /wants
 * (`addWant` in src/app/(app)/wants/actions.ts, via `pickRepresentative`),
 * with `deck_id` riding along as one extra hidden field. That is also what
 * makes tagging an already-wanted card work from here: the same submission
 * that would fail as "already on your want list" on /wants instead tags the
 * existing row to this deck — see that action's doc comment.
 */
export function AddToWishList({ deckId }: { deckId: string }) {
  const [state, add, adding] = useActionState(addWant, EMPTY_SOCIAL_STATE);

  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [results, setResults] = useState<CardNameSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const lastNonce = useRef(state.nonce);
  useEffect(() => {
    if (!state.nonce || state.nonce === lastNonce.current) return;
    lastNonce.current = state.nonce;
    setQuery("");
    setChosen(null);
    setQuantity(1);
    setResults([]);
  }, [state.nonce]);

  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const term = query.trim();
    if (chosen !== null || term.length < 2) return;

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
  }, [query, chosen]);

  const shown = query.trim().length < 2 || chosen !== null ? [] : results;

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <form action={add} className="space-y-2">
        <input type="hidden" name="deck_id" value={deckId} />
        <input type="hidden" name="card_name" value={chosen ?? ""} />
        <input type="hidden" name="quantity" value={quantity} />

        <div className="flex flex-wrap items-end gap-2">
          <Input
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              if (chosen !== null) setChosen(null);
              if (next.trim().length < 2) setResults([]);
            }}
            placeholder="Card name"
            aria-label="Search for a card to want for this deck"
            className="max-w-xs"
          />

          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Quantity
            <Select
              value={String(quantity)}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-label="How many to want"
              className="w-16 text-xs"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>

          <Button type="submit" variant="secondary" disabled={adding || !chosen} className="text-xs">
            {adding ? "Adding…" : "Add to wish list"}
          </Button>
        </div>
      </form>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      {query.trim().length >= 2 && chosen === null ? (
        shown.length === 0 ? (
          <p className="text-xs text-ink-muted">{searching ? "Searching…" : "No cards match that."}</p>
        ) : (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {shown.map((result) => (
              <li key={result.sample_card_id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(result.name);
                    setQuery(result.name);
                    setResults([]);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{result.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {result.printing_count} printing{result.printing_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
