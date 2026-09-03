"use client";

import Image from "next/image";
import { useActionState, useMemo, useState } from "react";

import {
  listDeckCard,
  removeDeckCard,
  setCommander,
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
            allEntries={stateful}
            commanderEntryId={commanderEntryId}
            commanderAction={commanderAction}
            commanderPending={commanderPending}
            sleeve={sleeve}
            sleeving={sleeving}
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
          allEntries={stateful}
          commanderAction={commanderAction}
          commanderPending={commanderPending}
          sleeve={sleeve}
          sleeving={sleeving}
        />
      ) : (
        <div className="columns-1 gap-6 lg:columns-2 [&>*]:break-inside-avoid">
          {groups.map((group) => (
            <ListSection
              key={group.section}
              group={group}
              deckId={deckId}
              allEntries={stateful}
              commanderEntryId={commanderEntryId}
              commanderAction={commanderAction}
              commanderPending={commanderPending}
              sleeve={sleeve}
              sleeving={sleeving}
            />
          ))}
        </div>
      )}

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
  allEntries,
  commanderEntryId,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
}: {
  group: DeckGroup<StatefulEntry>;
  deckId: string;
  /** The whole decklist, for the commander picker — see EmptySection. */
  allEntries: StatefulEntry[];
  commanderEntryId: string | null;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
}) {
  return (
    <section className="mb-6 break-inside-avoid">
      <h2 className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-semibold">
        {group.label}
        <span className="text-xs font-normal text-ink-muted">({group.cardCount})</span>
      </h2>

      {group.rows.length === 0 ? (
        <EmptySection
          section={group.section}
          deckId={deckId}
          allEntries={allEntries}
          commanderAction={commanderAction}
          commanderPending={commanderPending}
        />
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
 * commander yet" line. It doubles as the way to nominate one: clicking it
 * opens a picker over the whole decklist — every card, not just creatures and
 * planeswalkers, because whether a card can legally be a commander is
 * explicitly not this app's call to make (docs/CHARTER.md).
 */
function EmptySection({
  section,
  deckId,
  allEntries,
  commanderAction,
  commanderPending,
}: {
  section: DeckSection;
  deckId?: string;
  allEntries?: StatefulEntry[];
  commanderAction?: (formData: FormData) => void;
  commanderPending?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (section !== "commander") {
    return <p className="py-1 text-sm text-ink-muted">Nothing here yet.</p>;
  }

  return (
    <div className="space-y-2 py-1">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        aria-expanded={pickerOpen}
        className="text-sm text-ink-muted underline decoration-dotted hover:text-ink"
      >
        Please choose a commander.
      </button>

      {pickerOpen ? (
        <CommanderPicker
          deckId={deckId ?? ""}
          entries={allEntries ?? []}
          action={commanderAction ?? (() => {})}
          pending={commanderPending ?? false}
        />
      ) : null}
    </div>
  );
}

/** Every card on the decklist, pick one to nominate as commander. */
function CommanderPicker({
  deckId,
  entries,
  action,
  pending,
}: {
  deckId: string;
  entries: StatefulEntry[];
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-ink-muted">Add cards to the list before nominating a commander.</p>
    );
  }

  const sorted = [...entries].sort((a, b) =>
    (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""),
  );

  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
      {sorted.map((entry) => (
        <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm">{entry.cards?.name ?? "Unknown card"}</span>
          <ManaCost cost={entry.cards?.mana_cost} size="xs" />
          <form action={action}>
            <input type="hidden" name="deck_id" value={deckId} />
            <input type="hidden" name="card_id" value={entry.card_id} />
            <Button type="submit" variant="secondary" disabled={pending} className="text-xs">
              Nominate
            </Button>
          </form>
        </li>
      ))}
    </ul>
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
}: {
  entry: StatefulEntry;
  deckId: string;
  isCommander: boolean;
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
}) {
  const card = entry.cards;
  const preview = useCardPreview(card);
  const state = entry.entryState;

  return (
    <li className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted">
      <DeckStateMark entry={state} />

      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {state.sleeved}/{entry.quantity}
      </span>

      <span {...preview} tabIndex={0} className="min-w-0 flex-1 cursor-default truncate text-sm">
        {card?.name ?? "Unknown card"}
      </span>

      <ManaCost cost={card?.mana_cost} size="xs" />

      {/* Non-foil price: a list entry names a card, not a specific copy, so
          there is no finish to be more precise about. */}
      <Price value={priceFor(card, "nonfoil")} className="text-[11px] text-ink-muted" />

      <div
        className={cx(
          "flex shrink-0 items-center gap-0.5",
          isCommander ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        {/* Sleeve the outstanding copies, when there are copies to sleeve. */}
        {state.sleevable > 0 ? (
          <form action={sleeve}>
            <input type="hidden" name="deck_id" value={deckId} />
            <input type="hidden" name="card_id" value={entry.card_id} />
            <input type="hidden" name="quantity" value={state.sleevable} />
            <button
              type="submit"
              disabled={sleeving}
              title={`Sleeve ${state.sleevable} from your collection`}
              aria-label={`Sleeve ${state.sleevable} ${card?.name ?? "card"}`}
              className="rounded px-1 text-xs text-ink-muted hover:text-ink"
            >
              ↓
            </button>
          </form>
        ) : null}

        {/* Send sleeved copies back to the collection. */}
        {state.sleeved > 0 ? (
          <form action={unsleeveCard}>
            <input type="hidden" name="deck_id" value={deckId} />
            <input type="hidden" name="card_id" value={entry.card_id} />
            <input type="hidden" name="quantity" value={state.sleeved} />
            <button
              type="submit"
              title="Return to collection"
              aria-label={`Unsleeve ${card?.name ?? "card"}`}
              className="rounded px-1 text-xs text-ink-muted hover:text-ink"
            >
              ↑
            </button>
          </form>
        ) : null}

        {/* How many the list asks for. Dropping to zero removes the entry,
            which is handled server-side so the two cannot disagree. */}
        <form action={setDeckCardQuantity}>
          <input type="hidden" name="entry_id" value={entry.id} />
          <input type="hidden" name="deck_id" value={deckId} />
          <input type="hidden" name="quantity" value={entry.quantity - 1} />
          <button
            type="submit"
            title="Ask for one fewer"
            aria-label={`Ask for one fewer ${card?.name ?? "card"}`}
            className="rounded px-1 text-xs text-ink-muted hover:text-ink"
          >
            −
          </button>
        </form>

        <form action={setDeckCardQuantity}>
          <input type="hidden" name="entry_id" value={entry.id} />
          <input type="hidden" name="deck_id" value={deckId} />
          <input type="hidden" name="quantity" value={entry.quantity + 1} />
          <button
            type="submit"
            title="Ask for one more"
            aria-label={`Ask for one more ${card?.name ?? "card"}`}
            className="rounded px-1 text-xs text-ink-muted hover:text-ink"
          >
            +
          </button>
        </form>

        <form action={commanderAction}>
          <input type="hidden" name="deck_id" value={deckId} />
          <input type="hidden" name="card_id" value={isCommander ? "" : entry.card_id} />
          <button
            type="submit"
            disabled={commanderPending}
            title={isCommander ? "Clear commander" : "Set as commander"}
            className={cx(
              "rounded px-1 text-xs",
              isCommander ? "text-accent" : "text-ink-muted hover:text-ink",
            )}
          >
            {isCommander ? "★" : "☆"}
          </button>
        </form>

        <form action={removeDeckCard}>
          <input type="hidden" name="entry_id" value={entry.id} />
          <input type="hidden" name="deck_id" value={deckId} />
          <button
            type="submit"
            title="Remove from the list"
            aria-label={`Remove ${card?.name ?? "card"} from the list`}
            className="rounded px-1 text-xs text-ink-muted hover:text-danger"
          >
            ✕
          </button>
        </form>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Image view
// ---------------------------------------------------------------------------

function Gallery({
  groups,
  deckId,
  allEntries,
  commanderAction,
  commanderPending,
  sleeve,
  sleeving,
}: {
  groups: Array<DeckGroup<StatefulEntry>>;
  deckId: string;
  allEntries: StatefulEntry[];
  commanderAction: (formData: FormData) => void;
  commanderPending: boolean;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
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
            <EmptySection
              section={group.section}
              deckId={deckId}
              allEntries={allEntries}
              commanderAction={commanderAction}
              commanderPending={commanderPending}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {group.rows.map((entry) => (
                <GalleryCard
                  key={entry.id}
                  entry={entry}
                  deckId={deckId}
                  sleeve={sleeve}
                  sleeving={sleeving}
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
  sleeve,
  sleeving,
}: {
  entry: StatefulEntry;
  deckId: string;
  sleeve: (formData: FormData) => void;
  sleeving: boolean;
}) {
  const card = entry.cards;
  const preview = useCardPreview(card);
  const image = card?.image_uri ?? card?.image_uri_small;
  const state = entry.entryState;

  return (
    <li className="group space-y-1.5">
      <div
        {...preview}
        tabIndex={0}
        className={cx(
          "relative aspect-[488/680] overflow-hidden rounded-lg border bg-surface-muted",
          // A card you cannot play is dimmed as well as marked, so an
          // unplayable deck is obvious from across the room.
          state.state === "missing" ? "border-border opacity-55" : "border-border",
        )}
      >
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

        <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {state.sleeved}/{entry.quantity}
        </span>
      </div>

      <div className="flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {state.sleevable > 0 ? (
          <form action={sleeve}>
            <input type="hidden" name="deck_id" value={deckId} />
            <input type="hidden" name="card_id" value={entry.card_id} />
            <input type="hidden" name="quantity" value={state.sleevable} />
            <Button type="submit" variant="secondary" disabled={sleeving} className="text-[11px]">
              Sleeve
            </Button>
          </form>
        ) : null}

        {state.sleeved > 0 ? (
          <form action={unsleeveCard}>
            <input type="hidden" name="deck_id" value={deckId} />
            <input type="hidden" name="card_id" value={entry.card_id} />
            <input type="hidden" name="quantity" value={state.sleeved} />
            <Button type="submit" variant="ghost" className="text-[11px]">
              Unsleeve
            </Button>
          </form>
        ) : null}
      </div>
    </li>
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
 * Cards wanted for this deck (migration 00000000000017): the want list,
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
            your want list without being tied to any deck — and a card stays on your global{" "}
            <a href="/wants" className="text-accent underline">
              want list
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
        {/* Untag: the want survives, it just stops being "for this deck". */}
        <form action={untagAction}>
          <input type="hidden" name="want_id" value={entry.id} />
          <input type="hidden" name="deck_id" value="" />
          <button
            type="submit"
            title="Untag from this deck (stays on your want list)"
            aria-label={`Untag ${card?.name ?? "card"} from this deck`}
            className="rounded px-1 text-xs text-ink-muted hover:text-ink"
          >
            Untag
          </button>
        </form>

        {/* Remove entirely: takes it off the want list altogether. */}
        <form action={removeAction}>
          <input type="hidden" name="want_id" value={entry.id} />
          <button
            type="submit"
            title="Remove from your want list"
            aria-label={`Remove ${card?.name ?? "card"} from your want list`}
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
