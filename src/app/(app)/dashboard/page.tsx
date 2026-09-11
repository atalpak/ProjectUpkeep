import Image from "next/image";
import Link from "next/link";

import {
  getCrossDeckAvailableCount,
  getDashboardSummary,
  getUnsortedFromTradeCount,
  UNSORTED,
} from "@/lib/collection/queries";
import type { ColourBucket } from "@/lib/collection/breakdown";
import { getOpenTradeCounts, getWantListView } from "@/lib/social/queries";
import { cardDisplayName } from "@/lib/types";
import { CardPreviewLink } from "@/components/CardPanel";
import { formatPrice } from "@/lib/collection/pricing";
import { EmptyState, ListRow, PageHeader } from "@/components/ui";

export const metadata = { title: "Dashboard · Project Upkeep" };

/**
 * The dashboard, rebuilt around three things nothing else in the app surfaces:
 * cards that arrived by trade and are still unsorted, decks that could be
 * finished from spares sitting elsewhere, and wish-list matches with the
 * supplier named. Everything else here either duplicates /locations or
 * /collection more expensively than either of them, or belongs in the header
 * (alerts) already.
 *
 * No explicit `dynamic = "force-dynamic"` — same as most pages under (app).
 * That export exists only where Next would otherwise try to statically
 * generate a route with a dynamic segment (/u/[username], /decks/[id]) and
 * fail; this route has no segment to generate, and every query here reads the
 * session cookie through src/lib/supabase/server.ts, which already opts a
 * route out of static rendering on its own.
 */
export default async function DashboardPage() {
  const [summary, wantView, tradeCounts, unsortedFromTrade, decksAvailable] = await Promise.all([
    getDashboardSummary(),
    getWantListView(),
    getOpenTradeCounts(),
    getUnsortedFromTradeCount(),
    getCrossDeckAvailableCount(),
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
          <Hero summary={summary} />
          <Attention
            tradeCounts={tradeCounts}
            unsortedFromTrade={unsortedFromTrade}
            decksAvailable={decksAvailable}
            wantView={wantView}
          />
          <RecentlyAdded summary={summary} />
        </>
      )}
    </div>
  );
}

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;

/**
 * What the collection is worth, first and dominant — the number people open a
 * collection app to see — with the count and the standout card as a quieter
 * line beneath it, not four boxes of equal weight. The by-colour dots are the
 * one place the removed set/colour bar chart gets a (much smaller) successor.
 */
function Hero({ summary }: { summary: Summary }) {
  const { value } = summary;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink-muted">Collection value</p>
        <p className="font-display text-5xl font-semibold tracking-tight tabular-nums">
          {formatPrice(value.total)}
        </p>
        {summary.pricesAsOf ? (
          <p className="text-xs text-ink-muted">Prices as of {formatShortDate(summary.pricesAsOf)}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        <span>
          {summary.totalCards.toLocaleString()} card{summary.totalCards === 1 ? "" : "s"}
        </span>
        {value.mostValuable ? (
          <span>
            Most valuable: {value.mostValuable.name} ({formatPrice(value.mostValuable.value)})
          </span>
        ) : null}
        {value.unpricedRows > 0 ? (
          <span>
            {value.unpricedRows} {value.unpricedRows === 1 ? "entry" : "entries"} unpriced
          </span>
        ) : null}
      </div>

      {summary.breakdown.colours.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-ink-muted">
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

/** "Sep 8" — short enough to caption a hero number without competing with it. */
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
 * The things that actually need a decision, as a hairline-divided list rather
 * than the pill row this replaces. Every row here is grounded in something the
 * schema already tracked and nothing surfaced: ownership_history for a trade
 * arrival, the deck-availability state every deck page already computes, and
 * the supplier location matchWants() has always returned and every caller
 * used to drop.
 */
function Attention({
  tradeCounts,
  unsortedFromTrade,
  decksAvailable,
  wantView,
}: {
  tradeCounts: TradeCounts;
  unsortedFromTrade: number;
  decksAvailable: number;
  wantView: WantView;
}) {
  const matchedWants = wantView.wants.filter((want) => wantView.matches.has(want.id));
  const shownMatches = matchedWants.slice(0, WANT_MATCH_ROWS);
  const moreMatches = matchedWants.length - shownMatches.length;

  const hasAnything =
    tradeCounts.awaitingYou > 0 ||
    tradeCounts.expiringSoon > 0 ||
    unsortedFromTrade > 0 ||
    decksAvailable > 0 ||
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

          {decksAvailable > 0 ? (
            <ListRow href="/decks" icon={<DeckIcon />} trailing={<Arrow />}>
              {decksAvailable} deck {decksAvailable === 1 ? "entry" : "entries"} could be sleeved from
              cards you already own
            </ListRow>
          ) : null}

          {shownMatches.map((want) => {
            const supplier = wantView.matches.get(want.id)?.[0];
            const profile = supplier ? wantView.suppliers.get(supplier.ownerId) : undefined;
            const location = supplier?.locations.join(", ");
            return (
              <ListRow key={want.id} href="/wants" icon={<StarIcon />} trailing={<Arrow />}>
                {want.displayName}
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

function DeckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="3" width="9" height="12" rx="1.2" />
      <path d="M8.5 17h6a1 1 0 0 0 1-1V6" />
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
