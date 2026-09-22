"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  addWants,
  removeWant,
  setWantDeck,
  setWantQuantity,
} from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { CardPreviewLink, CardPreviewTarget, useMediaQuery } from "@/components/CardPanel";
import { FloatingMenu } from "@/components/FloatingMenu";
import { cardKey } from "@/lib/collection/availability";
import { displayPrice, formatPrice } from "@/lib/collection/pricing";
import { FlipButton, useCardFace } from "@/components/cards/FlipCard";
import { PrintingPicker, type PrintingOption } from "@/components/cards/PrintingPicker";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, Select, cx } from "@/components/ui";
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

/** Text rows, or a card-thumbnail grid — the same choice DeckWorkspace offers
 *  over a decklist, applied to the saved wish list below the add area. */
type ViewMode = "list" | "gallery";

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
  // Plain component state, not persisted — DeckWorkspace's equivalent toggle
  // (src/components/decks/DeckWorkspace.tsx) does the same: it is a
  // per-visit preference, not a setting worth a localStorage key.
  //
  // Its starting value is the one exception: standing at a table on a phone,
  // a column of names is a worse first look at a wish list than the art grid
  // is, so a narrow viewport starts on gallery instead of list. `null` means
  // "no explicit choice yet" — `useMediaQuery` (shared with CardPanel's own
  // presentation logic, same `useSyncExternalStore` reasoning) reports `false`
  // on the server and during hydration, so the first paint always matches
  // desktop's default and only flips to gallery once the client confirms a
  // narrow viewport, rather than flickering from one to the other.
  const isNarrow = useMediaQuery("(max-width: 639px)");
  const [view, setView] = useState<ViewMode | null>(null);
  const effectiveView: ViewMode = view ?? (isNarrow ? "gallery" : "list");

  return (
    <div className="space-y-5">
      <AddWant />

      {wants.length === 0 ? (
        <EmptyState title="Your wish list is empty.">
          Add cards you are chasing, and this page will show which friends have them open
          for trade.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-end">
            <ViewToggle view={effectiveView} onChange={setView} />
          </div>

          {effectiveView === "gallery" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {wants.map((want) => (
                <WantGalleryCard
                  key={want.id}
                  want={want}
                  suppliers={matches[want.id] ?? []}
                  decks={decks}
                />
              ))}
            </ul>
          ) : (
            <>
              {/* Below sm: the same stacked card every list row on this page
                  already used — a six-column table is not something a phone
                  reads by scrolling down, it's one you drag sideways for. */}
              <ul className="space-y-2 sm:hidden">
                {wants.map((want) => (
                  <WantRowView
                    key={want.id}
                    want={want}
                    suppliers={matches[want.id] ?? []}
                    decks={decks}
                  />
                ))}
              </ul>

              {/* sm and up: the same table shell CollectionTable uses
                  (bordered, rounded, `bg-surface-muted` header, `divide-y`
                  body) so "Table" here reads as the same kind of view as the
                  Collection page's, not a different design language. */}
              <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="border-b border-border bg-surface-muted text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Card
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        For
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Price
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Available
                      </th>
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {wants.map((want) => (
                      <WantTableRow
                        key={want.id}
                        want={want}
                        suppliers={matches[want.id] ?? []}
                        decks={decks}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(["list", "gallery"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          className={cx(
            "px-2.5 py-1.5 text-xs font-medium transition-colors",
            view === option ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
          )}
        >
          {option === "list" ? "Table" : "Images"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding: search -> draft rows -> one batch commit
// ---------------------------------------------------------------------------

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
            <PrintingPicker
              printings={draft.printings}
              value={card.scryfall_id}
              onChange={onSwitchPrinting}
              label={`Printing of ${draft.name}`}
              className="w-full max-w-sm"
            />
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
                    <Link href={`/u/${encodeURIComponent(s.username)}`} className="text-accent-text hover:underline">
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
    <li className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2">
      <CardPreviewLink
        card={want.cardId ?? undefined}
        href={`/collection?q=${encodeURIComponent(want.name)}`}
        // object-contain, not object-cover: a small crop's own aspect ratio
        // doesn't quite match aspect-[488/680], and at this size that was
        // cropping a sliver off the card rather than showing the whole thing.
        className="relative block aspect-[488/680] w-9 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
      >
        {want.image ? (
          <Image src={want.image} alt="" fill sizes="2.25rem" className="object-contain" unoptimized />
        ) : null}
      </CardPreviewLink>

      <div className="flex min-w-0 flex-1 items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={want.displayName}>
            {want.displayName}
          </p>
          {/* Read-only — the picker to change it lives in the ⋯ menu now. */}
          {want.deckName ? (
            <p className="truncate text-xs italic text-ink-muted" title={`For ${want.deckName}`}>
              For {want.deckName}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5 text-sm">
            <WantPrice want={want} />
            <WantCardMenu want={want} decks={decks} />
          </div>

          <p className="max-w-[16rem] truncate text-right text-xs">
            {suppliers.length === 0 ? (
              <span className="text-ink-muted">No one in your circle has this yet.</span>
            ) : (
              <span className="text-ink-muted">
                <span className="text-ink">{suppliers[0].username}</span> has{" "}
                {describeSupplier(suppliers[0].available, suppliers[0].locations)}
                {suppliers.length > 1 ? ` +${suppliers.length - 1} more` : ""}
              </span>
            )}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * The saved wish list's "Card" table row, sm and up — same cell shape and
 * spacing as `Cell`/`Row` in `CollectionTable.tsx`, so the two tables read as
 * one visual language rather than two.
 */
function WantTableRow({
  want,
  suppliers,
  decks,
}: {
  want: WantRow;
  suppliers: SupplierView[];
  decks: DeckOption[];
}) {
  return (
    <tr className="hover:bg-surface-muted">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          <CardPreviewLink
            card={want.cardId ?? undefined}
            href={`/collection?q=${encodeURIComponent(want.name)}`}
            className="relative block aspect-[488/680] w-9 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
          >
            {want.image ? (
              <Image src={want.image} alt="" fill sizes="2.25rem" className="object-contain" unoptimized />
            ) : null}
          </CardPreviewLink>
          <span className="min-w-0 truncate font-medium" title={want.displayName}>
            {want.displayName}
          </span>
        </div>
      </td>

      <td className={cx("px-3 py-2", !want.deckName && "text-ink-muted")}>{want.deckName ?? "—"}</td>

      <td className="px-3 py-2 text-right">
        <WantPrice want={want} />
      </td>

      <td className="max-w-[16rem] truncate px-3 py-2 text-ink-muted">
        {suppliers.length === 0 ? (
          "No one in your circle has this yet."
        ) : (
          <>
            <span className="text-ink">{suppliers[0].username}</span> has{" "}
            {describeSupplier(suppliers[0].available, suppliers[0].locations)}
            {suppliers.length > 1 ? ` +${suppliers.length - 1} more` : ""}
          </>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        <WantCardMenu want={want} decks={decks} />
      </td>
    </tr>
  );
}

/** A want's price, shown the same unconditional way a draft row's is — see
 *  DraftRowView. Renders nothing when the representative printing carries no
 *  price at all, same as that row. */
function WantPrice({ want }: { want: WantRow }) {
  if (!want.price || want.price.value === null) return null;
  return (
    <span className="text-xs tabular-nums text-ink-muted">
      {want.price.approximate ? "~" : ""}
      {formatPrice(want.price.value)}
    </span>
  );
}

/**
 * The saved wish list, as a card-thumbnail grid.
 *
 * Mirrors DeckWorkspace's Gallery/GalleryCard (src/components/decks/DeckWorkspace.tsx):
 * the image carries nothing but the art, every badge and control sits below
 * it. Space is tighter here than on a deck's gallery tile — there is no
 * per-card menu to fall back on — so the full supplier list `WantRowView`
 * spells out becomes the same one-line-plus-count `WishRow` on the deck page
 * already uses (name, whether a friend has it, +N more), rather than a
 * link per friend.
 */
function WantGalleryCard({
  want,
  suppliers,
  decks,
}: {
  want: WantRow;
  suppliers: SupplierView[];
  decks: DeckOption[];
}) {
  // The full-resolution crop, not the list row's small one — stretched to
  // this tile's width, the small crop read as blurry.
  const face = useCardFace(want.flip, "normal");
  const image = face.image ?? want.imageLarge ?? want.image;
  const displayName = face.name ?? want.displayName;

  return (
    <li className="space-y-1.5">
      {/* The flip control sits beside the tile's link, not inside it. */}
      <div className="relative">
        <CardPreviewLink
          card={want.cardId ?? undefined}
          href={`/collection?q=${encodeURIComponent(want.name)}`}
          className="relative block aspect-[488/680] overflow-hidden rounded-lg border border-border bg-surface-muted"
        >
          {image ? (
            <Image
              src={image}
              alt={displayName}
              fill
              sizes="(min-width: 1280px) 12rem, (min-width: 640px) 25vw, 45vw"
              className="object-cover"
              onError={face.onImageError}
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center p-2 text-center text-xs text-ink-muted">
              {displayName}
            </div>
          )}
        </CardPreviewLink>
        {face.canFlip ? <FlipButton onFlip={face.flip} otherName={face.otherName} /> : null}
      </div>

      {/* Same shape as the list row: name and, under it, "For <deck>" (the
          picker to change it lives in the ⋯ menu now, this is read-only) on
          the left; price and the ⋯ menu at the top right, who has it under
          those, right-aligned. */}
      <div className="flex items-start justify-between gap-1.5 text-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={displayName}>
            {displayName}
          </p>
          {want.deckName ? (
            <p className="truncate italic text-ink-muted" title={`For ${want.deckName}`}>
              For {want.deckName}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <WantPrice want={want} />
          <WantCardMenu want={want} decks={decks} />
        </div>
      </div>

      {suppliers.length > 0 ? (
        <p className="truncate text-right text-xs text-ink-muted">
          {suppliers[0].username} has {describeSupplier(suppliers[0].available, suppliers[0].locations)}
          {suppliers.length > 1 ? ` +${suppliers.length - 1} more` : ""}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The gallery tile's one control: quantity, deck assignment and Remove,
 * folded behind a ⋯ menu instead of three separate controls competing for a
 * tile that's mostly image. Same pattern as the deck page's row menu
 * (RowActions in DeckWorkspace.tsx) — outside-click and Escape close it, and
 * opening one closes any other that happens to be open.
 */
const WANT_MENU_OPEN = "want-card-menu-open";

function WantCardMenu({ want, decks }: { want: WantRow; decks: DeckOption[] }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function onOpenChange(next: boolean) {
    if (next) window.dispatchEvent(new CustomEvent(WANT_MENU_OPEN, { detail: menuId }));
    else trigger.current?.focus();
    setOpen(next);
  }

  useEffect(() => {
    function onOtherOpen(event: Event) {
      if ((event as CustomEvent<string>).detail !== menuId) setOpen(false);
    }
    window.addEventListener(WANT_MENU_OPEN, onOtherOpen);
    return () => window.removeEventListener(WANT_MENU_OPEN, onOtherOpen);
  }, [menuId]);

  return (
    <FloatingMenu
      open={open}
      onOpenChange={onOpenChange}
      panelClassName="w-48 overflow-hidden rounded-lg border border-border bg-surface-raised text-left shadow-xl"
      trigger={({ open, toggle, setTriggerRef }) => (
        <button
          ref={(el) => {
            trigger.current = el;
            setTriggerRef(el);
          }}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${want.displayName}`}
          className={cx(
            "rounded px-1 text-sm leading-none text-ink-muted transition-colors hover:text-ink",
            open && "text-ink",
          )}
        >
          ⋯
        </button>
      )}
    >
      {() => (
        <div role="menu">
          <div className="px-3 py-2">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">Quantity</span>
            <QuantityStepper want={want} />
          </div>

          {decks.length > 0 ? (
            <div className="border-t border-border px-3 py-2">
              <DeckTag want={want} decks={decks} />
            </div>
          ) : null}

          <div className="border-t border-border">
            <RemoveWantButton want={want} />
          </div>
        </div>
      )}
    </FloatingMenu>
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
    <div className="space-y-1">
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
    <form action={action}>
      <input type="hidden" name="want_id" value={want.id} />
      <button
        type="submit"
        className="block w-full px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-surface-muted"
      >
        Remove from wish list
      </button>
      {state.error ? <p className="px-3 pb-2 text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}
