"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { addWant, removeWant, setWantDeck, setWantQuantity } from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { CardPreviewLink } from "@/components/CardPanel";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, Select } from "@/components/ui";
import type { CardNameSuggestion } from "@/lib/types";
import type { WantRow } from "@/lib/social/wants";

/** A supplier of one want, resolved to a name on the server. */
export type SupplierView = {
  userId: string;
  username: string;
  available: number;
  locations: string[];
};

/** Enough of a deck to offer it in the tag picker. */
export type DeckOption = { id: string; name: string };

/**
 * The want list, and who can fill it.
 *
 * Adding is by card name — the same autocomplete the add-card form uses — and
 * the server picks a printing. Each row then says which friends have that card
 * open for trade right now, which is the whole reason the list exists.
 */
export function WantListManager({
  wants,
  matches,
  decks,
}: {
  wants: WantRow[];
  /** want-row id -> friends who have it open for trade. */
  matches: Record<string, SupplierView[]>;
  /** For the "which deck is this for" tag on each row. */
  decks: DeckOption[];
}) {
  return (
    <div className="space-y-5">
      <AddWant />

      {wants.length === 0 ? (
        <EmptyState title="Your want list is empty.">
          Add cards you are chasing, and this page will show which friends have them open
          for trade.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {wants.map((want) => (
            <WantRowView
              key={want.id}
              want={want}
              suppliers={matches[want.id] ?? []}
              decks={decks}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddWant() {
  const [state, action, pending] = useActionState(addWant, EMPTY_SOCIAL_STATE);

  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [suggestions, setSuggestions] = useState<CardNameSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const lastNonce = useRef(state.nonce);
  useEffect(() => {
    if (!state.nonce || state.nonce === lastNonce.current) return;
    lastNonce.current = state.nonce;
    setQuery("");
    setChosen(null);
    setQuantity(1);
    setSuggestions([]);
  }, [state.nonce]);

  useEffect(() => {
    const term = query.trim();
    // Nothing to fetch. Stale suggestions are cleared by the input handler, not
    // here, so this effect never sets state synchronously.
    if (chosen !== null || term.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { results: CardNameSuggestion[] };
          setSuggestions(body.results);
        }
      } catch {
        // A failed lookup just means no suggestions; the field still works.
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, chosen]);

  return (
    <Panel className="space-y-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="card_name" value={chosen ?? ""} />
        <input type="hidden" name="quantity" value={quantity} />

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-muted">Add a card you want</span>
            <Input
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                if (chosen !== null) setChosen(null);
                if (next.trim().length < 2) setSuggestions([]);
              }}
              placeholder="Rhystic Study"
              aria-label="Card name"
            />
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="size-8 rounded border border-border text-sm disabled:opacity-40 coarse:size-10"
              disabled={quantity <= 1}
              aria-label="One fewer"
            >
              −
            </button>
            <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              className="size-8 rounded border border-border text-sm coarse:size-10"
              aria-label="One more"
            >
              +
            </button>
          </div>

          <Button type="submit" disabled={pending || !chosen}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>

        {chosen ? (
          <p className="text-xs text-ink-muted">
            Adding <span className="font-medium text-ink">{chosen}</span> ×{quantity}.{" "}
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                setQuery("");
              }}
              className="text-accent underline"
            >
              change
            </button>
          </p>
        ) : searching ? (
          <p className="text-xs text-ink-muted">Searching…</p>
        ) : null}
      </form>

      {!chosen && suggestions.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {suggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => {
                  setChosen(s.name);
                  setQuery(s.name);
                  setSuggestions([]);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
              >
                {s.sample_image_uri ? (
                  <Image
                    src={s.sample_image_uri}
                    alt=""
                    width={28}
                    height={39}
                    className="rounded-sm"
                    unoptimized
                  />
                ) : (
                  <span className="h-[39px] w-[28px] rounded-sm bg-surface-muted" />
                )}
                <span className="font-medium">{s.name}</span>
                <span className="ml-auto text-xs text-ink-muted">
                  {s.printing_count} printing{s.printing_count === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>
    </Panel>
  );
}

function WantRowView({
  want,
  suppliers,
  decks,
}: {
  want: WantRow;
  suppliers: SupplierView[];
  decks: DeckOption[];
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex gap-3">
        <CardPreviewLink
          card={want.cardId ?? undefined}
          href={`/collection?q=${encodeURIComponent(want.name)}`}
          className="relative block aspect-[488/680] w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
        >
          {want.image ? (
            <Image src={want.image} alt="" fill sizes="3rem" className="object-cover" unoptimized />
          ) : null}
        </CardPreviewLink>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{want.name}</span>
            <QuantityStepper want={want} />
            <RemoveWantButton want={want} />
          </div>

          <div className="mt-1.5 text-sm">
            {suppliers.length === 0 ? (
              <span className="text-ink-muted">No one in your circle has this open for trade.</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Badge>Available</Badge>
                {suppliers.map((s, i) => (
                  <span key={s.userId}>
                    <Link
                      href={`/u/${encodeURIComponent(s.username)}`}
                      className="text-accent hover:underline"
                    >
                      {s.username}
                    </Link>{" "}
                    <span className="text-ink-muted tabular-nums">×{s.available}</span>
                    {i < suppliers.length - 1 ? <span className="text-ink-muted">,</span> : null}
                  </span>
                ))}
              </span>
            )}
          </div>

          {decks.length > 0 ? <DeckTag want={want} decks={decks} /> : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Which deck a want is for, and a picker to change or clear it.
 *
 * `want.deckId`/`deckName` are only ever populated for the signed-in user's
 * own list (src/lib/social/queries.ts never joins them in for a friend's), so
 * this only renders meaningfully here — this page only ever shows your own
 * list to begin with.
 */
function DeckTag({ want, decks }: { want: WantRow; decks: DeckOption[] }) {
  const [state, action] = useActionState(setWantDeck, EMPTY_SOCIAL_STATE);

  return (
    <div className="mt-1.5 space-y-1">
      <form action={action} className="flex items-center gap-1.5 text-xs">
        <input type="hidden" name="want_id" value={want.id} />
        <span className="text-ink-muted">For</span>
        <Select
          name="deck_id"
          defaultValue={want.deckId ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label={`Which deck ${want.name} is for`}
          className="w-40 py-1 text-xs"
        >
          <option value="">No particular deck</option>
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name}
            </option>
          ))}
        </Select>
      </form>
      {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}
    </div>
  );
}

function QuantityStepper({ want }: { want: WantRow }) {
  const [state, action] = useActionState(setWantQuantity, EMPTY_SOCIAL_STATE);

  return (
    <div className="flex items-center gap-1">
      <form action={action} className="flex items-center gap-1">
        <input type="hidden" name="want_id" value={want.id} />
        <button
          type="submit"
          name="quantity"
          value={want.quantity - 1}
          disabled={want.quantity <= 1}
          className="size-6 rounded border border-border text-xs disabled:opacity-40 coarse:size-9"
          aria-label={`Want one fewer ${want.name}`}
        >
          −
        </button>
        <span className="w-5 text-center text-xs tabular-nums" title="How many you want">
          {want.quantity}
        </span>
        <button
          type="submit"
          name="quantity"
          value={want.quantity + 1}
          className="size-6 rounded border border-border text-xs coarse:size-9"
          aria-label={`Want one more ${want.name}`}
        >
          +
        </button>
      </form>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </div>
  );
}

function RemoveWantButton({ want }: { want: WantRow }) {
  const [state, action] = useActionState(removeWant, EMPTY_SOCIAL_STATE);

  return (
    <div className="ml-auto flex items-center gap-2">
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      <form action={action}>
        <input type="hidden" name="want_id" value={want.id} />
        <button type="submit" className="text-xs text-ink-muted hover:text-danger">
          Remove
        </button>
      </form>
    </div>
  );
}
