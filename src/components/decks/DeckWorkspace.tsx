"use client";

import Image from "next/image";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  bulkSleeveEntries,
  bulkUnsleeveEntries,
  listDeckCard,
  removeDeckCard,
  setCommander,
  setDeckCardPrinting,
  setDeckCardQuantity,
  sleeveCard,
  unsleeveCard,
} from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { removeWant, setWantDeck } from "@/app/(app)/wants/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { ManaCost } from "@/components/ManaCost";
import { Price, PriceToggle } from "@/components/PriceToggle";
import { priceFor } from "@/lib/collection/pricing";
import { AddToDeckList } from "@/components/decks/AddToDeckList";
import { AddToWishList } from "@/components/decks/AddToWishList";
import { DeckStateMark } from "@/components/decks/DeckStateMark";
import { Badge, Banner, Button, Card as Panel, EmptyState, Select, cx } from "@/components/ui";
import { availabilityFor, type Availability } from "@/lib/collection/availability";
import { countsFor, deckProgress, type EntryState } from "@/lib/collection/deck-state";
import {
  DECK_SORTS,
  DECK_SORT_LABELS,
  groupDeck,
  type DeckGroup,
  type DeckSection,
  type DeckSort,
} from "@/lib/collection/deck-view";
import type { DeckListEntry, WishListEntry } from "@/lib/collection/queries";
import type { CardInstanceWithCard } from "@/lib/types";

/** A friend who already has a wish-list card open for trade. */
export type WishSupplierView = { username: string; available: number };

/**
 * One deck: the list it is meant to be, and how much of it is really in the box.
 *
 * Every entry carries one of three states — sleeved, available, or none
 * available — and that mark is the point of the page. It answers, per card and
 * at a glance, the question a deckbuilder asks constantly: can I actually play
 * this deck right now, and if not, what is stopping me?
 */

type ViewMode = "list" | "gallery";

/** A list entry with its state worked out. */
type StatefulEntry = DeckListEntry & { entryState: EntryState };

export function DeckWorkspace({
  deckId,
  entries,
  stranded,
  availability,
  commanderEntryId,
  wishList,
  wishMatches,
}: {
  deckId: string;
  entries: DeckListEntry[];
  /** Sleeved cards the list does not mention. */
  stranded: CardInstanceWithCard[];
  availability: Map<string, Availability>;
  commanderEntryId: string | null;
  /** Want-list entries tagged to this deck (migration 00000000000017). */
  wishList: WishListEntry[];
  /** want-row id -> friends who already have it open for trade. */
  wishMatches: Record<string, WishSupplierView[]>;
}) {
  const [view, setView] = useState<ViewMode>("list");
  const [sort, setSort] = useState<DeckSort>("name");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [sleeveState, sleeve, sleeving] = useActionState(sleeveCard, EMPTY_DECK_STATE);
  const [commanderState, commanderAction, commanderPending] = useActionState(
    setCommander,
    EMPTY_DECK_STATE,
  );

  const stateful = useMemo<StatefulEntry[]>(
    () =>
      entries.map((entry) => ({
        ...entry,
        entryState: countsFor(
          entry.quantity,
          entry.sleeved,
          availabilityFor(availability, entry.cards),
        ),
      })),
    [entries, availability],
  );

  const groups = useMemo(
    () => groupDeck(stateful, sort, commanderEntryId, { alwaysIncludeCommander: true }),
    [stateful, sort, commanderEntryId],
  );

  const progress = useMemo(
    () => deckProgress(stateful.map((e) => e.entryState)),
    [stateful],
  );

  // Entries that a bulk "Sleeve" would actually act on: not fully sleeved, and
  // enough spare copies owned to finish them. This is also what "Select
  // sleeveable" ticks, so the selection matches what the button will do.
  const sleeveableIds = useMemo(
    () =>
      stateful
        .filter((e) => e.entryState.outstanding > 0 && e.entryState.available >= e.entryState.outstanding)
        .map((e) => e.id),
    [stateful],
  );

  // A revalidation can drop entries that were selected (removed, or merged by a
  // printing change) — never act on an id that is no longer on the list.
  const liveSelected = useMemo(() => {
    const present = new Set(stateful.map((e) => e.id));
    return [...selected].filter((id) => present.has(id));
  }, [selected, stateful]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSleeveableSelected =
    sleeveableIds.length > 0 && sleeveableIds.every((id) => selected.has(id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">
              {progress.sleeved} of {progress.wanted}
            </span>{" "}
            sleeved · {progress.entries} card{progress.entries === 1 ? "" : "s"} on the list
            {progress.missingEntries > 0 ? (
              <> · {progress.missingEntries} you do not own</>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Sort
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as DeckSort)}
              aria-label="Sort cards within each section"
              className="w-36 text-xs"
            >
              {DECK_SORTS.map((option) => (
                <option key={option} value={option}>
                  {DECK_SORT_LABELS[option]}
                </option>
              ))}
            </Select>
          </label>

          <PriceToggle />

          <ViewToggle view={view} onChange={setView} />

          {sleeveableIds.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allSleeveableSelected) sleeveableIds.forEach((id) => next.delete(id));
                  else sleeveableIds.forEach((id) => next.add(id));
                  return next;
                })
              }
            >
              {allSleeveableSelected
                ? "Clear selection"
                : `Select sleeveable (${sleeveableIds.length})`}
            </Button>
          ) : null}

          <Button type="button" onClick={() => setAdding((v) => !v)}>
            {adding ? "Done adding" : "Add cards"}
          </Button>
        </div>
      </div>

      <Banner kind="error">{sleeveState.error}</Banner>
      <Banner kind="success">{sleeveState.notice}</Banner>
      <Banner kind="error">{commanderState.error}</Banner>
      <Banner kind="success">{commanderState.notice}</Banner>

      {adding ? <AddToDeckList deckId={deckId} /> : null}

      {entries.length === 0 ? (
        <>
          {/* Choosing a commander is a decision about the deck, not about the
              list, so the prompt belongs here even before a single card has
              been added — a deck with cards physically in it but no list yet
              would otherwise never be asked the question. */}
          <ListSection
            group={{ section: "commander", label: "Commander", rows: [], cardCount: 0 }}
            deckId={deckId}
            commanderEntryId={commanderEntryId}
            commanderAction={commanderAction}
            commanderPending={commanderPending}
            sleeve={sleeve}
            sleeving={sleeving}
            selectedIds={selected}
            onToggleSelected={toggleSelected}
          />

          <EmptyState title="This deck has no list yet.">
            Use <span className="font-medium">Add cards</span> to build the list. You can add
            cards you do not own yet — they will show as missing until you get them.
          </EmptyState>
        </>
      ) : view === "gallery" ? (
        <Gallery
          groups={groups}
          deckId={deckId}
          commanderEntryId={commanderEntryId}
          commanderAction={commanderAction}
          commanderPending={commanderPending}
          sleeve={sleeve}
          sleeving={sleeving}
          selectedIds={selected}
          onToggleSelected={toggleSelected}
        />
      ) : (
        <div className="columns-1 gap-6 lg:columns-2 [&>*]:break-inside-avoid">
          {groups.map((group) => (
            <ListSection
              key={group.section}
              group={group}
              deckId={deckId}
              commanderEntryId={commanderEntryId}
              commanderAction={commanderAction}
              commanderPending={commanderPending}
              sleeve={sleeve}
              sleeving={sleeving}
              selectedIds={selected}
              onToggleSelected={toggleSelected}
            />
          ))}
        </div>
      )}

      {liveSelected.length > 0 ? (
        <DeckBulkBar
          deckId={deckId}
          entryIds={liveSelected}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {stranded.length > 0 ? <Stranded deckId={deckId} rows={stranded} /> : null}

      <WishList deckId={deckId} wishList={wishList} matches={wishMatches} sort={sort} />
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
          {option === "list" ? "Text" : "Images"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text view
// ---------------------------------------------------------------------------

function ListSection({
  group,
  deckId,
  commanderEntryId,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
  selectedIds,
  onToggleSelected,
}: {
  group: DeckGroup<StatefulEntry>;
  deckId: string;
  commanderEntryId: string | null;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
}) {
  return (
    <section className="mb-6 break-inside-avoid">
      <h2 className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-semibold">
        {group.label}
        <span className="text-xs font-normal text-ink-muted">({group.cardCount})</span>
      </h2>

      {group.rows.length === 0 ? (
        <EmptySection section={group.section} />
      ) : (
        <ul>
          {group.rows.map((entry) => (
            <ListRow
              key={entry.id}
              entry={entry}
              deckId={deckId}
              isCommander={entry.id === commanderEntryId}
              commanderAction={commanderAction}
              commanderPending={commanderPending}
              sleeve={sleeve}
              sleeving={sleeving}
              selected={selectedIds.has(entry.id)}
              onToggleSelected={() => onToggleSelected(entry.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What an empty section says.
 *
 * Only Commander can be empty and still shown, so this is really the "no
 * commander yet" line. A commander is nominated from a card's own ⋯ menu
 * (RowActions) rather than from here — whether a card can legally be a
 * commander is explicitly not this app's call to make (docs/CHARTER.md), so
 * every card on the list carries the option.
 */
function EmptySection({ section }: { section: DeckSection }) {
  if (section !== "commander") {
    return <p className="py-1 text-sm text-ink-muted">Nothing here yet.</p>;
  }

  return (
    <p className="py-1 text-sm text-ink-muted">
      No commander set. Open a card&rsquo;s <span aria-hidden="true">⋯</span> menu and choose{" "}
      <span className="whitespace-nowrap">&ldquo;Set as commander&rdquo;</span>.
    </p>
  );
}

function ListRow({
  entry,
  deckId,
  isCommander,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
  selected,
  onToggleSelected,
}: {
  entry: StatefulEntry;
  deckId: string;
  isCommander: boolean;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const card = entry.cards;
  const preview = useCardPreview(card);
  const state = entry.entryState;

  return (
    <li
      className={cx(
        "group flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted",
        selected && "bg-accent-soft",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelected}
        aria-label={`Select ${card?.name ?? "card"}`}
        className="size-3.5 shrink-0 accent-accent"
      />

      <DeckStateMark entry={state} />

      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {state.sleeved}/{entry.quantity}
      </span>

      <span {...preview} tabIndex={0} className="flex min-w-0 flex-1 cursor-default items-center gap-1 truncate text-sm">
        {isCommander ? (
          <span className="text-accent" title="Commander" aria-label="Commander">
            ★
          </span>
        ) : null}
        <span className="truncate">{card?.name ?? "Unknown card"}</span>
      </span>

      <ManaCost cost={card?.mana_cost} size="xs" />

      {/* Non-foil price: a list entry names a card, not a specific copy, so
          there is no finish to be more precise about. */}
      <Price value={priceFor(card, "nonfoil")} className="text-[11px] text-ink-muted" />

      <RowActions
        entry={entry}
        deckId={deckId}
        state={state}
        isCommander={isCommander}
        commanderAction={commanderAction}
        commanderPending={commanderPending}
        sleeve={sleeve}
        sleeving={sleeving}
      />
    </li>
  );
}

type Printing = {
  scryfall_id: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  released_at: string | null;
  rarity: string | null;
};

/** Fired when a row menu opens, so any other open one closes itself. */
const ROW_MENU_OPEN = "deck-row-menu-open";

/**
 * The one control on a decklist row: a ⋯ menu whose items say in words what
 * the old cluster of ↓ ↑ − + ☆ ✕ buttons did, plus a printing switcher.
 *
 * Every item is a tiny <form> posting a server action, the same way the old
 * icon buttons were — so this stays a progressive-enhancement control, not a
 * client-only one, and closing the menu on submit is cosmetic.
 */
function RowActions({
  entry,
  deckId,
  state,
  isCommander,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
}: {
  entry: StatefulEntry;
  deckId: string;
  state: EntryState;
  isCommander: boolean;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
}) {
  const name = entry.cards?.name ?? "";
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [showPrintings, setShowPrintings] = useState(false);
  const [printings, setPrintings] = useState<Printing[] | null>(null);
  const [loadingPrintings, setLoadingPrintings] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setShowPrintings(false);
  };

  function openMenu() {
    // Only one row menu at a time — tell the others to close.
    window.dispatchEvent(new CustomEvent(ROW_MENU_OPEN, { detail: menuId }));
    setOpen(true);
  }

  useEffect(() => {
    function onOtherOpen(event: Event) {
      if ((event as CustomEvent<string>).detail !== menuId) {
        setOpen(false);
        setShowPrintings(false);
      }
    }
    window.addEventListener(ROW_MENU_OPEN, onOtherOpen);
    return () => window.removeEventListener(ROW_MENU_OPEN, onOtherOpen);
  }, [menuId]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function loadPrintings() {
    setShowPrintings(true);
    if (printings || loadingPrintings || !name) return;
    setLoadingPrintings(true);
    try {
      const res = await fetch(`/api/cards/printings?name=${encodeURIComponent(name)}`);
      const json = (await res.json()) as { printings?: Printing[] };
      setPrintings(json.printings ?? []);
    } catch {
      setPrintings([]);
    } finally {
      setLoadingPrintings(false);
    }
  }

  const item =
    "block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-surface-muted disabled:opacity-40";

  return (
    <div ref={container} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name || "card"}`}
        className={cx(
          "rounded px-1.5 text-sm leading-none text-ink-muted transition-colors hover:text-ink",
          open && "text-ink",
        )}
      >
        ⋯
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        >
          {showPrintings ? (
            <>
              <button
                type="button"
                onClick={() => setShowPrintings(false)}
                className="block w-full border-b border-border px-3 py-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted"
              >
                ← Back
              </button>
              <div className="max-h-64 overflow-y-auto">
                {loadingPrintings ? (
                  <p className="px-3 py-2 text-xs text-ink-muted">Loading printings…</p>
                ) : !printings || printings.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-muted">No printings found.</p>
                ) : (
                  printings.map((p) => {
                    const current = p.scryfall_id === entry.card_id;
                    return (
                      <form key={p.scryfall_id} action={setDeckCardPrinting} onSubmit={close}>
                        <input type="hidden" name="entry_id" value={entry.id} />
                        <input type="hidden" name="deck_id" value={deckId} />
                        <input type="hidden" name="card_id" value={p.scryfall_id} />
                        <button
                          type="submit"
                          disabled={current}
                          className={cx(
                            "block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-muted disabled:hover:bg-transparent",
                            current && "font-medium text-accent",
                          )}
                        >
                          {p.set_name ?? p.set_code?.toUpperCase() ?? "Unknown set"}
                          {p.collector_number ? ` · #${p.collector_number}` : ""}
                          {p.released_at ? ` · ${p.released_at.slice(0, 4)}` : ""}
                          {current ? " (current)" : ""}
                        </button>
                      </form>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {state.sleevable > 0 ? (
                <form action={sleeve} onSubmit={close}>
                  <input type="hidden" name="deck_id" value={deckId} />
                  <input type="hidden" name="card_id" value={entry.card_id} />
                  <input type="hidden" name="quantity" value={state.sleevable} />
                  <button type="submit" role="menuitem" disabled={sleeving} className={item}>
                    Sleeve {state.sleevable} from your collection
                  </button>
                </form>
              ) : null}

              {state.sleeved > 0 ? (
                <form action={unsleeveCard} onSubmit={close}>
                  <input type="hidden" name="deck_id" value={deckId} />
                  <input type="hidden" name="card_id" value={entry.card_id} />
                  <input type="hidden" name="quantity" value={state.sleeved} />
                  <button type="submit" role="menuitem" className={item}>
                    Return {state.sleeved} to your collection
                  </button>
                </form>
              ) : null}

              <form action={setDeckCardQuantity} onSubmit={close}>
                <input type="hidden" name="entry_id" value={entry.id} />
                <input type="hidden" name="deck_id" value={deckId} />
                <input type="hidden" name="quantity" value={entry.quantity + 1} />
                <button type="submit" role="menuitem" className={item}>
                  Ask for one more
                </button>
              </form>

              {entry.quantity > 1 ? (
                <form action={setDeckCardQuantity} onSubmit={close}>
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <input type="hidden" name="deck_id" value={deckId} />
                  <input type="hidden" name="quantity" value={entry.quantity - 1} />
                  <button type="submit" role="menuitem" className={item}>
                    Ask for one fewer
                  </button>
                </form>
              ) : null}

              <form action={commanderAction} onSubmit={close}>
                <input type="hidden" name="deck_id" value={deckId} />
                <input type="hidden" name="card_id" value={isCommander ? "" : entry.card_id} />
                <button type="submit" role="menuitem" disabled={commanderPending} className={item}>
                  {isCommander ? "Clear commander" : "Set as commander"}
                </button>
              </form>

              <button type="button" role="menuitem" className={item} onClick={loadPrintings}>
                Change printing…
              </button>

              <form action={removeDeckCard} onSubmit={close} className="border-t border-border">
                <input type="hidden" name="entry_id" value={entry.id} />
                <input type="hidden" name="deck_id" value={deckId} />
                <button type="submit" role="menuitem" className={cx(item, "text-danger")}>
                  Remove from the list
                </button>
              </form>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image view
// ---------------------------------------------------------------------------

function Gallery({
  groups,
  deckId,
  commanderEntryId,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
  selectedIds,
  onToggleSelected,
}: {
  groups: Array<DeckGroup<StatefulEntry>>;
  deckId: string;
  commanderEntryId: string | null;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.section}>
          <h2 className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-semibold">
            {group.label}
            <span className="text-xs font-normal text-ink-muted">({group.cardCount})</span>
          </h2>

          {group.rows.length === 0 ? (
            <EmptySection section={group.section} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {group.rows.map((entry) => (
                <GalleryCard
                  key={entry.id}
                  entry={entry}
                  deckId={deckId}
                  isCommander={entry.id === commanderEntryId}
                  commanderAction={commanderAction}
                  commanderPending={commanderPending}
                  sleeve={sleeve}
                  sleeving={sleeving}
                  selected={selectedIds.has(entry.id)}
                  onToggleSelected={() => onToggleSelected(entry.id)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function GalleryCard({
  entry,
  deckId,
  isCommander,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
  selected,
  onToggleSelected,
}: {
  entry: StatefulEntry;
  deckId: string;
  isCommander: boolean;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const card = entry.cards;
  const preview = useCardPreview(card);
  const image = card?.image_uri ?? card?.image_uri_small;
  const state = entry.entryState;

  return (
    <li className="space-y-1.5">
      <div
        {...preview}
        tabIndex={0}
        className={cx(
          "relative aspect-[488/680] overflow-hidden rounded-lg border bg-surface-muted",
          // A card you cannot play is dimmed as well as marked, so an
          // unplayable deck is obvious from across the room.
          state.state === "missing" ? "opacity-55" : "",
          selected ? "border-accent ring-1 ring-accent" : "border-border",
        )}
      >
        <label className="absolute left-1.5 bottom-1.5 z-10 flex size-6 items-center justify-center rounded bg-surface/90">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${card?.name ?? "card"}`}
            className="size-3.5 accent-accent"
          />
        </label>

        {image ? (
          <Image
            src={image}
            alt={card?.name ?? "Card"}
            fill
            sizes="(min-width: 1280px) 12rem, (min-width: 640px) 25vw, 45vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-ink-muted">
            {card?.name ?? "No image"}
          </div>
        )}

        {/* The state mark sits on the art itself, which is the only thing shown
            in this view. */}
        <span className="absolute left-1.5 top-1.5">
          <DeckStateMark entry={state} size="lg" />
        </span>

        {isCommander ? (
          <span
            className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold text-accent"
            title="Commander"
          >
            ★
          </span>
        ) : null}

        <span className="absolute bottom-1.5 right-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {state.sleeved}/{entry.quantity}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-xs text-ink-muted">{card?.name ?? "Unknown card"}</span>
        <RowActions
          entry={entry}
          deckId={deckId}
          state={state}
          isCommander={isCommander}
          commanderAction={commanderAction}
          commanderPending={commanderPending}
          sleeve={sleeve}
          sleeving={sleeving}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Bulk sleeve / unsleeve
// ---------------------------------------------------------------------------

/**
 * Actions over the selected list entries.
 *
 * Pinned to the bottom of the viewport so it stays reachable however far down
 * the list the selection was made. "Sleeve" only completes entries it can
 * finish from spare copies; "Unsleeve" returns every sleeved copy of each
 * selected entry. The selection is not cleared afterwards — a revalidation
 * refreshes the rows and the parent drops any ids that no longer exist, which
 * is what you want when the next thing you do is act on the same rows again.
 */
function DeckBulkBar({
  deckId,
  entryIds,
  onClear,
}: {
  deckId: string;
  entryIds: string[];
  onClear: () => void;
}) {
  const [sleeveState, sleeveAction, sleevingBulk] = useActionState(
    bulkSleeveEntries,
    EMPTY_DECK_STATE,
  );
  const [unsleeveState, unsleeveAction, unsleevingBulk] = useActionState(
    bulkUnsleeveEntries,
    EMPTY_DECK_STATE,
  );

  const ids = entryIds.join(",");
  const busy = sleevingBulk || unsleevingBulk;
  const error = sleeveState.error ?? unsleeveState.error;
  const notice = sleeveState.notice ?? unsleeveState.notice;

  return (
    <div className="sticky bottom-4 z-20 rounded-lg border border-border bg-surface-raised p-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{entryIds.length} selected</span>

        <form action={sleeveAction}>
          <input type="hidden" name="deck_id" value={deckId} />
          <input type="hidden" name="entry_ids" value={ids} />
          <Button type="submit" variant="secondary" disabled={busy} className="text-xs">
            Sleeve
          </Button>
        </form>

        <form action={unsleeveAction}>
          <input type="hidden" name="deck_id" value={deckId} />
          <input type="hidden" name="entry_ids" value={ids} />
          <Button type="submit" variant="secondary" disabled={busy} className="text-xs">
            Unsleeve
          </Button>
        </form>

        <button
          type="button"
          onClick={onClear}
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          Clear
        </button>

        {error ? <span className="text-xs text-danger">{error}</span> : null}
        {notice ? <span className="text-xs text-ink-muted">{notice}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sleeved but unlisted
// ---------------------------------------------------------------------------

/**
 * Recovery for cards physically in the deck with no list entry.
 *
 * The database keeps the list and the box in step now (migration
 * 00000000000016), so this only appears for cards filed into a deck before that
 * migration was applied. Applying it backfills them and this section stays
 * empty for good; the buttons are here for anyone who hits the gap first.
 */
function Stranded({ deckId, rows }: { deckId: string; rows: CardInstanceWithCard[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Not on the list yet</h2>
      <p className="text-xs text-ink-muted">
        These are sleeved in the deck but were filed before the list caught up. Add them, or
        take them back to your collection.
      </p>

      <Panel className="divide-y divide-border p-0">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              {row.quantity}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {row.cards?.name ?? "Unknown card"}
              <FoilMark finish={row.finish} />
            </span>

            <form action={listDeckCard}>
              <input type="hidden" name="deck_id" value={deckId} />
              <input type="hidden" name="card_id" value={row.card_id} />
              <input type="hidden" name="quantity" value={row.quantity} />
              <Button type="submit" className="text-xs">
                Add to list
              </Button>
            </form>

            <form action={unsleeveCard}>
              <input type="hidden" name="deck_id" value={deckId} />
              <input type="hidden" name="card_id" value={row.card_id} />
              <input type="hidden" name="quantity" value={row.quantity} />
              <Button type="submit" variant="secondary" className="text-xs">
                Return to collection
              </Button>
            </form>
          </div>
        ))}
      </Panel>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Wish list
// ---------------------------------------------------------------------------

/**
 * Cards wanted for this deck (migration 00000000000017): the wish list,
 * filtered to whatever is tagged with `deck_id = deckId`.
 *
 * Grouped through the same `groupDeck`/`sectionFor` the decklist above uses —
 * see the note on `GroupableRow` in src/lib/collection/deck-view.ts, which
 * exists specifically so a second list does not need a second grouping rule.
 * There is no commander concept for a wish, so this never passes a
 * `commanderRowId` and the Commander heading never appears here.
 *
 * Collapsed by default when there is nothing to show, expanded when there
 * is — a deck with an empty wish list should not open on an empty box.
 */
function WishList({
  deckId,
  wishList,
  matches,
  sort,
}: {
  deckId: string;
  wishList: WishListEntry[];
  matches: Record<string, WishSupplierView[]>;
  sort: DeckSort;
}) {
  const [open, setOpen] = useState(wishList.length > 0);
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => groupDeck(wishList, sort), [wishList, sort]);
  const totalWanted = useMemo(
    () => wishList.reduce((sum, w) => sum + w.quantity, 0),
    [wishList],
  );

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
      >
        <span>
          Wish list
          {wishList.length > 0 ? (
            <span className="ml-1.5 font-normal text-ink-muted">
              ({totalWanted} card{totalWanted === 1 ? "" : "s"})
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-ink-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="space-y-4">
          <p className="text-xs text-ink-muted">
            Cards you want for this deck specifically. Tagging is optional — a card can be on
            your wish list without being tied to any deck — and a card stays on your global{" "}
            <a href="/wants" className="text-accent underline">
              wish list
            </a>{" "}
            whether or not it is tagged here.
          </p>

          <Button type="button" variant="secondary" onClick={() => setAdding((v) => !v)} className="text-xs">
            {adding ? "Done adding" : "Add to wish list"}
          </Button>

          {adding ? <AddToWishList deckId={deckId} /> : null}

          {wishList.length === 0 ? (
            <p className="py-1 text-sm text-ink-muted">Nothing on this deck&rsquo;s wish list yet.</p>
          ) : (
            <div className="columns-1 gap-6 lg:columns-2 [&>*]:break-inside-avoid">
              {groups.map((group) => (
                <section key={group.section} className="mb-6 break-inside-avoid">
                  <h3 className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-semibold">
                    {group.label}
                    <span className="text-xs font-normal text-ink-muted">({group.cardCount})</span>
                  </h3>
                  <ul>
                    {group.rows.map((entry) => (
                      <WishRow key={entry.id} entry={entry} suppliers={matches[entry.id] ?? []} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function WishRow({
  entry,
  suppliers,
}: {
  entry: WishListEntry;
  suppliers: WishSupplierView[];
}) {
  const card = entry.cards;
  const preview = useCardPreview(card);
  const [untagState, untagAction] = useActionState(setWantDeck, EMPTY_SOCIAL_STATE);
  const [removeState, removeAction] = useActionState(removeWant, EMPTY_SOCIAL_STATE);

  return (
    <li className="group flex flex-wrap items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted">
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {entry.quantity}
      </span>

      <span {...preview} tabIndex={0} className="min-w-0 flex-1 cursor-default truncate text-sm">
        {card?.name ?? "Unknown card"}
      </span>

      <ManaCost cost={card?.mana_cost} size="xs" />

      {suppliers.length > 0 ? (
        <Badge>
          {suppliers[0].username}
          {suppliers.length > 1 ? ` +${suppliers.length - 1}` : ""} has it
        </Badge>
      ) : null}

      <div className="flex shrink-0 items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        {/* Untag: the wish survives, it just stops being "for this deck". */}
        <form action={untagAction}>
          <input type="hidden" name="want_id" value={entry.id} />
          <input type="hidden" name="deck_id" value="" />
          <button
            type="submit"
            title="Untag from this deck (stays on your wish list)"
            aria-label={`Untag ${card?.name ?? "card"} from this deck`}
            className="rounded px-1 text-xs text-ink-muted hover:text-ink"
          >
            Untag
          </button>
        </form>

        {/* Remove entirely: takes it off the wish list altogether. */}
        <form action={removeAction}>
          <input type="hidden" name="want_id" value={entry.id} />
          <button
            type="submit"
            title="Remove from your wish list"
            aria-label={`Remove ${card?.name ?? "card"} from your wish list`}
            className="rounded px-1 text-xs text-ink-muted hover:text-danger"
          >
            ✕
          </button>
        </form>
      </div>

      {untagState.error ? <p className="w-full text-xs text-danger">{untagState.error}</p> : null}
      {removeState.error ? <p className="w-full text-xs text-danger">{removeState.error}</p> : null}
    </li>
  );
}
