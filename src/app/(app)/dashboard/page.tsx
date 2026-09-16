import Image from "next/image";
import Link from "next/link";

import {
  getDashboardSummary,
  getDecks,
  getUnsortedFromTradeCount,
  UNSORTED,
  type DeckSummary,
} from "@/lib/collection/queries";
import type { ColourBucket } from "@/lib/collection/breakdown";
import { getOpenTradeCounts, getWantListView } from "@/lib/social/queries";
import { cardDisplayName } from "@/lib/types";
import { CardPreviewLink, CardPreviewTarget } from "@/components/CardPanel";
import { formatPrice } from "@/lib/collection/pricing";
import { Badge, EmptyState, ListRow, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Dashboard · Project Upkeep" };

/**
 * The dashboard, rebuilt (again) around a simple split: things that need a
 * decision at the top, then where things stand. Three sections:
 *
 *   - Needs attention — trades waiting on you, cards still unsorted from a
 *     trade, wish-list matches with the supplier named. Nothing here is a new
 *     query; it is all things the schema already tracked and no page
 *     surfaced together.
 *   - Deck status — every deck with a decklist, ready or missing N, sorted
 *     worst-off first. Reuses getDecks()'s own cardCount/sleevedCount rather
 *     than a new per-deck query — the /decks page already computes exactly
 *     this.
 *   - Collection status — value, count, unsorted, deck total. Demoted to the
 *     bottom and to plain stat tiles on purpose: real, but not a decision.
 *
 * No explicit `dynamic = "force-dynamic"` — same as most pages under (app).
 * That export exists only where Next would otherwise try to statically
 * generate a route with a dynamic segment (/u/[username], /decks/[id]) and
 * fail; this route has no segment to generate, and every query here reads the
 * session cookie through src/lib/supabase/server.ts, which already opts a
 * route out of static rendering on its own.
 */
export default async function DashboardPage() {
  const [summary, wantView, tradeCounts, unsortedFromTrade, decks] = await Promise.all([
    getDashboardSummary(),
    getWantListView(),
    getOpenTradeCounts(),
    getUnsortedFromTradeCount(),
    getDecks(),
  ]);

  const isEmpty = summary.totalEntries === 0;

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="Where your collection stands right now." />

      {isEmpty ? (
        <EmptyState title="Nothing tracked yet.">
          <p>
            Once you{" "}
            <Link href="/collection/add" className="text-accent underline">
              add your first card
            </Link>
            , its totals and whereabouts show up here.
          </p>
        </EmptyState>
      ) : (
        <>
          <Attention tradeCounts={tradeCounts} unsortedFromTrade={unsortedFromTrade} wantView={wantView} />
          <DeckStatus decks={decks} />
          <CollectionStatus summary={summary} deckCount={decks.length} />
          <RecentlyAdded summary={summary} />
        </>
      )}
    </div>
  );
}

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;

/** "Sep 8" — short enough to caption a stat tile without competing with it. */
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COLOUR_DOT_CLASS: Partial<Record<ColourBucket, string>> = {
  W: "bg-w",
  U: "bg-u",
  B: "bg-b",
  R: "bg-r",
  G: "bg-g",
};

/** A colour's mana-coloured dot — WUBRG as a real accent, not a chart. Gold
 *  for a multicolour stack, an outline for colourless: neither is one of the
 *  five, so neither gets one of the five tokens. */
function ColourDot({ bucket }: { bucket: ColourBucket }) {
  const solid = COLOUR_DOT_CLASS[bucket];
  if (solid) return <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${solid}`} />;
  if (bucket === "M") {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2.5 rounded-full bg-[linear-gradient(135deg,#e9d27a,#c9a227)]"
      />
    );
  }
  return (
    <span aria-hidden="true" className="inline-block size-2.5 rounded-full border border-ink-muted" />
  );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

type TradeCounts = Awaited<ReturnType<typeof getOpenTradeCounts>>;
type WantView = Awaited<ReturnType<typeof getWantListView>>;

/** How many wish-list matches to name before folding the rest into "view all". */
const WANT_MATCH_ROWS = 3;

/**
 * The things that actually need a decision, as a hairline-divided list.
 * Every row here is grounded in something the schema already tracked and
 * nothing surfaced: ownership_history for a trade arrival, and the supplier
 * location matchWants() has always returned and every caller used to drop.
 *
 * Deck completeness used to have a line here too ("N deck entries could be
 * sleeved from cards you already own") — dropped in favour of the Deck status
 * section below, which says the same thing per deck instead of as one vague
 * total.
 */
function Attention({
  tradeCounts,
  unsortedFromTrade,
  wantView,
}: {
  tradeCounts: TradeCounts;
  unsortedFromTrade: number;
  wantView: WantView;
}) {
  const matchedWants = wantView.wants.filter((want) => wantView.matches.has(want.id));
  const shownMatches = matchedWants.slice(0, WANT_MATCH_ROWS);
  const moreMatches = matchedWants.length - shownMatches.length;

  const hasAnything =
    tradeCounts.awaitingYou > 0 ||
    tradeCounts.expiringSoon > 0 ||
    unsortedFromTrade > 0 ||
    shownMatches.length > 0;

  return (
    <section aria-label="Needs attention" className="space-y-1">
      <h2 className="text-sm font-semibold">Needs attention</h2>

      {!hasAnything ? (
        <p className="py-2 text-sm text-ink-muted">Nothing needs your attention right now.</p>
      ) : (
        <div>
          {tradeCounts.awaitingYou > 0 ? (
            <ListRow href="/friends" icon={<TradeIcon />} trailing={<Arrow />}>
              {tradeCounts.awaitingYou} trade{tradeCounts.awaitingYou === 1 ? "" : "s"} waiting on you
            </ListRow>
          ) : null}

          {tradeCounts.expiringSoon > 0 ? (
            <ListRow href="/friends" icon={<ClockIcon />} trailing={<Arrow />}>
              {tradeCounts.expiringSoon} offer{tradeCounts.expiringSoon === 1 ? "" : "s"} expiring soon
            </ListRow>
          ) : null}

          {unsortedFromTrade > 0 ? (
            <ListRow href={`/collection?location=${UNSORTED}`} icon={<InboxIcon />} trailing={<Arrow />}>
              {unsortedFromTrade} card{unsortedFromTrade === 1 ? "" : "s"} from a trade{" "}
              {unsortedFromTrade === 1 ? "is" : "are"} still unsorted
            </ListRow>
          ) : null}

          {shownMatches.map((want) => {
            const supplier = wantView.matches.get(want.id)?.[0];
            const profile = supplier ? wantView.suppliers.get(supplier.ownerId) : undefined;
            const location = supplier?.locations.join(", ");
            return (
              <ListRow key={want.id} href="/wants" icon={<StarIcon />} trailing={<Arrow />}>
                <CardPreviewTarget
                  card={want.cardId ?? undefined}
                  stopClickPropagation
                  className="hover:underline"
                >
                  {want.displayName}
                </CardPreviewTarget>
                {profile ? ` — ${profile.username}` : ""}
                {location ? `, ${location}` : ""}
              </ListRow>
            );
          })}

          {moreMatches > 0 ? (
            <ListRow href="/wants" trailing={<Arrow />}>
              <span className="text-ink-muted">
                {moreMatches} more wish-list {moreMatches === 1 ? "match" : "matches"}
              </span>
            </ListRow>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="text-ink-muted">
      →
    </span>
  );
}

const ICON_PROPS = {
  "aria-hidden": true as const,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "size-4 shrink-0 text-ink-muted",
};

function TradeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11.5 5.5 4h9l2.5 7.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 11.5h4.5a2.5 2.5 0 0 0 5 0H17" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 3.5 12 8l5 .6-3.7 3.4.9 4.9-4.2-2.4-4.2 2.4.9-4.9L3 8.6 8 8z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Deck status
// ---------------------------------------------------------------------------

/** How many decks to name before folding the rest into "view all". */
const DECK_STATUS_ROWS = 4;

/**
 * Every deck with a decklist, ready or with N left to sleeve — worst-off
 * first, since that is the one you would act on. `cardCount` and
 * `sleevedCount` are `getDecks()`'s own numbers, already computed for the
 * /decks page; this is the same data, not a new query.
 *
 * Deliberately "N to sleeve", not "N missing": `cardCount - sleevedCount` is
 * only "not yet physically in this deck" — some of that gap might be spares
 * sitting in a binder, ready to pull in for free, not cards you don't own.
 * Telling those two apart per deck needs the same cross-deck spare-allocation
 * logic `countAvailableAcrossDecks` (deck-state.ts) does *in aggregate* for
 * the whole collection — doing it per deck means solving the same "which deck
 * gets the one spare two decks are both short" problem per row, which is a
 * real follow-up, not this pass.
 *
 * Decks with no decklist at all (`cardCount === 0`, a deck that exists as a
 * location but has never had a list built for it) are left out entirely
 * rather than shown as "0 of 0, ready" — that is not a meaningful ready, and
 * a brand-new deck should not read as an achievement.
 */
function DeckStatus({ decks }: { decks: DeckSummary[] }) {
  const withList = decks.filter((deck) => deck.cardCount > 0);
  if (withList.length === 0) return null;

  const ranked = [...withList].sort((a, b) => {
    const aOutstanding = a.cardCount - a.sleevedCount;
    const bOutstanding = b.cardCount - b.sleevedCount;
    return bOutstanding - aOutstanding || a.name.localeCompare(b.name);
  });

  const shown = ranked.slice(0, DECK_STATUS_ROWS);
  const more = ranked.length - shown.length;

  return (
    <section aria-label="Deck status" className="space-y-1">
      <h2 className="text-sm font-semibold">Deck status</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        {shown.map((deck) => {
          const outstanding = Math.max(0, deck.cardCount - deck.sleevedCount);
          return (
            <Link
              key={deck.id}
              href={`/decks/${deck.id}`}
              className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-surface-muted"
            >
              <span className="truncate font-medium">{deck.name}</span>
              {outstanding === 0 ? (
                <Badge>Ready</Badge>
              ) : (
                <span className="shrink-0 text-xs text-ink-muted">
                  {outstanding} to sleeve
                </span>
              )}
            </Link>
          );
        })}

        {more > 0 ? (
          <Link
            href="/decks"
            className="block px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface-muted"
          >
            {more} more {more === 1 ? "deck" : "decks"}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collection status
// ---------------------------------------------------------------------------

/**
 * Value, count, unsorted, deck total — plain stat tiles, not the loud
 * five-line hero this section used to be. Real numbers, but none of them is a
 * decision, so none of them leads the page any more.
 */
function CollectionStatus({ summary, deckCount }: { summary: Summary; deckCount: number }) {
  const { value } = summary;

  return (
    <section aria-label="Collection status" className="space-y-3">
      <h2 className="text-sm font-semibold">Collection status</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Collection value"
          value={formatPrice(value.total)}
          hint={summary.pricesAsOf ? `As of ${formatShortDate(summary.pricesAsOf)}` : undefined}
        />
        <Stat label="Total cards" value={summary.totalCards.toLocaleString()} />
        <Stat label="Unsorted" value={summary.unsortedCount.toLocaleString()} />
        <Stat label="Decks" value={deckCount.toLocaleString()} />
      </div>

      {value.mostValuable || value.unpricedRows > 0 ? (
        <p className="text-xs text-ink-muted">
          {value.mostValuable ? (
            <>
              Most valuable:{" "}
              <CardPreviewLink
                card={value.mostValuable.cardId ?? undefined}
                href={`/collection?q=${encodeURIComponent(value.mostValuable.name)}`}
                className="text-ink hover:underline"
              >
                {value.mostValuable.name}
              </CardPreviewLink>{" "}
              ({formatPrice(value.mostValuable.value)})
            </>
          ) : null}
          {value.unpricedRows > 0
            ? `${value.mostValuable ? " · " : ""}${value.unpricedRows} ${value.unpricedRows === 1 ? "entry" : "entries"} unpriced`
            : ""}
        </p>
      ) : null}

      {summary.breakdown.colours.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          {summary.breakdown.colours.map(({ bucket, label, count }) => (
            <span key={bucket} className="flex items-center gap-1.5" title={label}>
              <ColourDot bucket={bucket} />
              <span className="tabular-nums">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recently added
// ---------------------------------------------------------------------------

/**
 * A small glance strip, not the six-large-image section this replaces. A
 * proper "newest first" way to browse the collection lives on /collection
 * itself, as the Added column and its sort — this is just enough to catch
 * "oh, that's the one I added yesterday" without the page reserving a fifth
 * of the screen for it.
 */
function RecentlyAdded({ summary }: { summary: Summary }) {
  if (summary.recent.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Recently added</h2>
        <Link href="/collection" className="text-xs text-accent underline">
          View all
        </Link>
      </div>

      <ul className="flex flex-wrap gap-2">
        {summary.recent.map((instance) => {
          const card = instance.cards;
          return (
            <li key={instance.id}>
              <CardPreviewLink
                card={card}
                href={`/collection?q=${encodeURIComponent(card?.name ?? "")}`}
                className="group block"
              >
                <div className="relative size-14 overflow-hidden rounded-lg border border-border bg-surface-muted">
                  {card?.image_uri_small ? (
                    <Image
                      src={card.image_uri_small}
                      alt={card ? cardDisplayName(card) : ""}
                      fill
                      sizes="3.5rem"
                      className="object-cover transition-opacity group-hover:opacity-90"
                      // Scryfall's CDN 400s any request without a browser-like
                      // User-Agent, which is what Next's optimizer sends. Letting
                      // the browser fetch the image directly is the whole fix.
                      unoptimized
                    />
                  ) : null}

                  {instance.quantity > 1 ? (
                    <span className="absolute right-0.5 top-0.5 rounded bg-surface/90 px-1 text-[10px] font-semibold tabular-nums">
                      ×{instance.quantity}
                    </span>
                  ) : null}
                </div>
              </CardPreviewLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
