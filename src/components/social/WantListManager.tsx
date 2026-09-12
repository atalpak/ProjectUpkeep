"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  addWants,
  removeWant,
  setWantDeck,
  setWantQuantity,
} from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { CardPreviewLink, CardPreviewTarget } from "@/components/CardPanel";
import { cardKey } from "@/lib/collection/availability";
import { displayPrice, formatPrice } from "@/lib/collection/pricing";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, Select } from "@/components/ui";
import type { Card, CardNameSuggestion } from "@/lib/types";
import { describeSupplier, type WantRow } from "@/lib/social/wants";

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
 * The wish list, and who can fill it.
 *
 * Adding is by card name — the same autocomplete the add-card form uses — but
 * picking a name only opens a *draft row*, not a save. The card's printing,
 * quantity and who among your friends already has it open for trade are all
 * settled before anything is written, and several cards can be queued this
 * way before one "Add" commits the lot. That is the whole reason `addWants`
 * exists as a batch action rather than the single-row `addWant` this page used
 * to call directly.
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
        <EmptyState title="Your wish list is empty.">
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

// ---------------------------------------------------------------------------
// Adding: search -> draft rows -> one batch commit
// ---------------------------------------------------------------------------

type PrintingOption = {
  scryfall_id: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  released_at: string | null;
};

/** A card queued to add, before it is saved. */
type DraftRow = {
  /** Client-only id — never sent to the server, just a React key. */
  draftId: string;
  /** The name search resolved to; carried so a failed card fetch still shows something. */
  name: string;
  card: Card | null;
  printings: PrintingOption[] | null;
  quantity: number;
  suppliers: SupplierView[];
  loadingSuppliers: boolean;
};

function printingLabel(p: PrintingOption): string {
  const set = p.set_name ?? p.set_code?.toUpperCase() ?? "Unknown set";
  const number = p.collector_number ? ` · #${p.collector_number}` : "";
  return `${set}${number}`;
}

function AddWant() {
  const [state, action, pending] = useActionState(addWants, EMPTY_SOCIAL_STATE);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CardNameSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const lastNonce = useRef(state.nonce);
  useEffect(() => {
    if (!state.nonce || state.nonce === lastNonce.current) return;
    lastNonce.current = state.nonce;
    setDrafts([]);
    setQuery("");
    setSuggestions([]);
  }, [state.nonce]);

  useEffect(() => {
    const term = query.trim();
    // Nothing to fetch. Stale suggestions are cleared by the input handler,
    // not here, so this effect never sets state synchronously.
    if (term.length < 2) return;

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
  }, [query]);

  /** Adds a new draft row for a name just picked from search, and loads its detail. */
  function addDraft(name: string, sampleCardId: string) {
    const draftId = crypto.randomUUID();
    setDrafts((prev) => [
      ...prev,
      { draftId, name, card: null, printings: null, quantity: 1, suppliers: [], loadingSuppliers: false },
    ]);
    setQuery("");
    setSuggestions([]);

    void loadCard(draftId, sampleCardId);
    void loadPrintings(draftId, name);
  }

  async function loadCard(draftId: string, cardId: string) {
    try {
      const res = await fetch(`/api/cards/${cardId}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { card: Card };
      setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, card: body.card } : d)));

      const key = cardKey(body.card);
      if (key) void loadSuppliers(draftId, key);
    } catch {
      // The row just stays without a card; the remove button still works.
    }
  }

  async function loadPrintings(draftId: string, name: string) {
    try {
      const res = await fetch(`/api/cards/printings?name=${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { printings: PrintingOption[] };
      setDrafts((prev) =>
        prev.map((d) => (d.draftId === draftId ? { ...d, printings: body.printings ?? [] } : d)),
      );
    } catch {
      setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, printings: [] } : d)));
    }
  }

  async function loadSuppliers(draftId: string, key: string) {
    setDrafts((prev) =>
      prev.map((d) => (d.draftId === draftId ? { ...d, loadingSuppliers: true } : d)),
    );
    try {
      const res = await fetch(`/api/cards/friend-suppliers?key=${encodeURIComponent(key)}`);
      const body = res.ok ? ((await res.json()) as { suppliers: SupplierView[] }) : { suppliers: [] };
      setDrafts((prev) =>
        prev.map((d) =>
          d.draftId === draftId
            ? { ...d, suppliers: body.suppliers ?? [], loadingSuppliers: false }
            : d,
        ),
      );
    } catch {
      setDrafts((prev) =>
        prev.map((d) => (d.draftId === draftId ? { ...d, loadingSuppliers: false } : d)),
      );
    }
  }

  function setDraftQuantity(draftId: string, quantity: number) {
    setDrafts((prev) =>
      prev.map((d) => (d.draftId === draftId ? { ...d, quantity: Math.max(1, Math.min(99, quantity)) } : d)),
    );
  }

  function removeDraft(draftId: string) {
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
  }

  async function switchPrinting(draftId: string, scryfallId: string) {
    setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, card: null } : d)));
    await loadCard(draftId, scryfallId);
  }

  const rowsJson = JSON.stringify(
    drafts
      .filter((d): d is DraftRow & { card: Card } => d.card !== null)
      .map((d) => ({ cardId: d.card.scryfall_id, quantity: d.quantity })),
  );
  const readyCount = drafts.filter((d) => d.card !== null).length;

  return (
    <Panel className="space-y-4">
      <div className="space-y-1">
        <span className="text-xs font-medium text-ink-muted">Add a card to your wish list</span>
        <Input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (next.trim().length < 2) setSuggestions([]);
          }}
          placeholder="Rhystic Study"
          aria-label="Card name"
        />
      </div>

      {searching ? <p className="text-xs text-ink-muted">Searching…</p> : null}

      {suggestions.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {suggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => addDraft(s.name, s.sample_card_id)}
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

      {drafts.length > 0 ? (
        <ul className="space-y-2">
          {drafts.map((draft) => (
            <DraftRowView
              key={draft.draftId}
              draft={draft}
              onQuantityChange={(q) => setDraftQuantity(draft.draftId, q)}
              onRemove={() => removeDraft(draft.draftId)}
              onSwitchPrinting={(id) => void switchPrinting(draft.draftId, id)}
            />
          ))}
        </ul>
      ) : null}

      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="rows" value={rowsJson} />
        {/* Deliberately bigger than a normal action button — this now commits
            everything queued above, not one quick add. */}
        <Button
          type="submit"
          disabled={pending || readyCount === 0}
          className="px-6 py-3 text-base"
        >
          {pending
            ? "Adding…"
            : `Add ${readyCount > 0 ? readyCount : ""} card${readyCount === 1 ? "" : "s"} to wish list`}
        </Button>
        {drafts.length > readyCount ? (
          <span className="text-xs text-ink-muted">Still loading {drafts.length - readyCount}…</span>
        ) : null}
      </form>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>
    </Panel>
  );
}

function DraftRowView({
  draft,
  onQuantityChange,
  onRemove,
  onSwitchPrinting,
}: {
  draft: DraftRow;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
  onSwitchPrinting: (scryfallId: string) => void;
}) {
  const { card } = draft;
  const price = card ? displayPrice(card, "nonfoil") : null;

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex gap-3">
        <CardPreviewTarget
          card={card ?? undefined}
          className="relative block aspect-[488/680] w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
        >
          {card?.image_uri_small ? (
            <Image
              src={card.image_uri_small}
              alt=""
              fill
              sizes="3rem"
              className="object-cover"
              unoptimized
            />
          ) : null}
        </CardPreviewTarget>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{card ? card.name : draft.name}</span>
            {price && price.value !== null ? (
              <span className="text-xs tabular-nums text-ink-muted">
                {price.approximate ? "~" : ""}
                {formatPrice(price.value)}
              </span>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => onQuantityChange(draft.quantity - 1)}
                disabled={draft.quantity <= 1}
                className="size-7 rounded border border-border text-sm disabled:opacity-40 coarse:size-11"
                aria-label={`One fewer ${draft.name}`}
              >
                −
              </button>
              <span className="w-6 text-center text-sm tabular-nums">{draft.quantity}</span>
              <button
                type="button"
                onClick={() => onQuantityChange(draft.quantity + 1)}
                className="size-7 rounded border border-border text-sm coarse:size-11"
                aria-label={`One more ${draft.name}`}
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${draft.name} from this batch`}
              className="text-ink-muted hover:text-danger"
            >
              ×
            </button>
          </div>

          {draft.printings && draft.printings.length > 1 && card ? (
            <Select
              value={card.scryfall_id}
              onChange={(e) => onSwitchPrinting(e.target.value)}
              aria-label={`Printing of ${draft.name}`}
              className="w-full max-w-xs py-1 text-xs"
            >
              {draft.printings.map((p) => (
                <option key={p.scryfall_id} value={p.scryfall_id}>
                  {printingLabel(p)}
                </option>
              ))}
            </Select>
          ) : null}

          <div className="text-sm">
            {!card ? (
              <span className="text-ink-muted">Loading…</span>
            ) : draft.loadingSuppliers ? (
              <span className="text-ink-muted">Checking your circle…</span>
            ) : draft.suppliers.length === 0 ? (
              <span className="text-ink-muted">No one in your circle has this open for trade.</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Badge>Available</Badge>
                {draft.suppliers.map((s, i) => (
                  <span key={s.username}>
                    <Link href={`/u/${encodeURIComponent(s.username)}`} className="text-accent hover:underline">
                      {s.username}
                    </Link>{" "}
                    <span className="text-ink-muted">has {describeSupplier(s.available, s.locations)}</span>
                    {i < draft.suppliers.length - 1 ? <span className="text-ink-muted">,</span> : null}
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

// ---------------------------------------------------------------------------
// The saved wish list
// ---------------------------------------------------------------------------

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
            <span className="font-medium">{want.displayName}</span>
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
                    <span className="text-ink-muted">
                      has {describeSupplier(s.available, s.locations)}
                    </span>
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
          aria-label={`Which deck ${want.displayName} is for`}
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
          className="size-6 rounded border border-border text-xs disabled:opacity-40 coarse:size-11"
          aria-label={`One fewer ${want.displayName}`}
        >
          −
        </button>
        <span className="w-5 text-center text-xs tabular-nums" title="How many you want on your wish list">
          {want.quantity}
        </span>
        <button
          type="submit"
          name="quantity"
          value={want.quantity + 1}
          className="size-6 rounded border border-border text-xs coarse:size-11"
          aria-label={`One more ${want.displayName}`}
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
