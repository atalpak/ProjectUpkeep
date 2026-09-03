"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { addWant, removeWant, setWantQuantity } from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { CardPreviewLink } from "@/components/CardPanel";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input } from "@/components/ui";
import type { CardNameSuggestion } from "@/lib/types";
import type { WantRow } from "@/lib/social/wants";

/** A supplier of one want, resolved to a name on the server. */
export type SupplierView = {
  userId: string;
  username: string;
  available: number;
  locations: string[];
};

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
}: {
  wants: WantRow[];
  /** want-row id -> friends who have it open for trade. */
  matches: Record<string, SupplierView[]>;
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
            <WantRowView key={want.id} want={want} suppliers={matches[want.id] ?? []} />
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

function WantRowView({ want, suppliers }: { want: WantRow; suppliers: SupplierView[] }) {
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
            <form action={removeWant} className="ml-auto">
              <input type="hidden" name="want_id" value={want.id} />
              <button type="submit" className="text-xs text-ink-muted hover:text-danger">
                Remove
              </button>
            </form>
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
        </div>
      </div>
    </li>
  );
}

function QuantityStepper({ want }: { want: WantRow }) {
  return (
    <form action={setWantQuantity} className="flex items-center gap-1">
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
  );
}
