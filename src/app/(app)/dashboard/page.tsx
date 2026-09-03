import Image from "next/image";
import Link from "next/link";

import { getDashboardSummary, UNSORTED } from "@/lib/collection/queries";
import {
  getOpenTradeCounts,
  getUnreadNotificationCount,
  getWantListView,
} from "@/lib/social/queries";
import { LOCATION_TYPE_LABELS } from "@/lib/types";
import { CardPreviewLink } from "@/components/CardPanel";
import { formatPrice } from "@/lib/collection/pricing";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Dashboard · Project Upkeep" };

export default async function DashboardPage() {
  const [summary, wantView, tradeCounts, unread] = await Promise.all([
    getDashboardSummary(),
    getWantListView(),
    getOpenTradeCounts(),
    getUnreadNotificationCount(),
  ]);
  const isEmpty = summary.totalEntries === 0;

  // Everything that is asking for a decision, in one row.
  const attention = [
    {
      count: tradeCounts.awaitingYou,
      href: "/friends",
      label: (n: number) => `${n} trade${n === 1 ? "" : "s"} waiting on you`,
    },
    {
      count: tradeCounts.expiringSoon,
      href: "/friends",
      label: (n: number) => `${n} offer${n === 1 ? "" : "s"} expiring soon`,
    },
    {
      count: unread,
      href: "/notifications",
      label: (n: number) => `${n} unread alert${n === 1 ? "" : "s"}`,
    },
    {
      count: wantView.matches.size,
      href: "/wants",
      label: (n: number) =>
        `${n} wish-list card${n === 1 ? "" : "s"} available from a friend`,
    },
    {
      count: summary.unsortedCount,
      href: `/collection?location=${UNSORTED}`,
      label: (n: number) => `${n} card${n === 1 ? "" : "s"} unsorted`,
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="Where your collection stands right now." />

      {attention.length > 0 ? (
        <section aria-label="Needs attention" className="flex flex-wrap gap-2">
          {attention.map((item) => (
            <Link
              key={item.label(item.count)}
              href={item.href}
              className="rounded-full border border-accent/40 bg-accent-soft px-3 py-1.5 text-sm transition-colors hover:border-accent"
            >
              {item.label(item.count)} <span aria-hidden="true">→</span>
            </Link>
          ))}
        </section>
      ) : null}

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
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Value leads: it is the number people open a collection app to
                see. The hint says what it could not price, so the figure never
                implies it covers everything. */}
            <Stat
              label="Collection value"
              value={formatPrice(summary.value.total)}
              hint={
                summary.value.unpricedRows > 0
                  ? `${summary.value.unpricedRows} entries unpriced`
                  : "TCGplayer, via Scryfall"
              }
            />
            <Stat label="Cards" value={summary.totalCards.toLocaleString()} />
            <Stat
              label="Most valuable"
              value={
                summary.value.mostValuable ? formatPrice(summary.value.mostValuable.value) : "—"
              }
              hint={summary.value.mostValuable?.name ?? "nothing priced yet"}
            />
            <Stat label="Locations" value={summary.locationCount.toLocaleString()} />
            <Stat
              label="Unsorted"
              value={summary.unsortedCount.toLocaleString()}
              hint={
                summary.unsortedCount > 0 ? (
                  <Link
                    href={`/collection?location=${UNSORTED}`}
                    className="text-accent underline"
                  >
                    file these
                  </Link>
                ) : (
                  "all filed"
                )
              }
            />
          </section>

          <RecentlyAdded summary={summary} />
          <LocationBreakdown summary={summary} />
        </>
      )}
    </div>
  );
}

type Summary = Awaited<ReturnType<typeof getDashboardSummary>>;

function RecentlyAdded({ summary }: { summary: Summary }) {
  if (summary.recent.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Recently added</h2>
        <Link href="/collection" className="text-xs text-accent underline">
          View all
        </Link>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summary.recent.map((instance) => {
          const card = instance.cards;
          return (
            <li key={instance.id}>
              <CardPreviewLink
                card={card}
                href={`/collection?q=${encodeURIComponent(card?.name ?? "")}`}
                className="group block space-y-1.5"
              >
                <div className="relative aspect-[488/680] overflow-hidden rounded-lg border border-border bg-surface-muted">
                  {card?.image_uri_small ? (
                    <Image
                      src={card.image_uri_small}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 12rem, (min-width: 640px) 30vw, 45vw"
                      className="object-cover transition-opacity group-hover:opacity-90"
                      // Scryfall's CDN 400s any request without a browser-like
                      // User-Agent, which is what Next's optimizer sends. Letting
                      // the browser fetch the image directly is the whole fix.
                      unoptimized
                    />
                  ) : (
                    // A small number of printings genuinely have no art on Scryfall.
                    <div className="flex h-full items-center justify-center px-2 text-center text-xs text-ink-muted">
                      No image
                    </div>
                  )}

                  {instance.quantity > 1 ? (
                    <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
                      ×{instance.quantity}
                    </span>
                  ) : null}
                </div>

                <div className="truncate text-xs font-medium" title={card?.name}>
                  {card?.name ?? "Unknown printing"}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
                  {instance.locations?.name ?? "Unsorted"}
                </div>
              </CardPreviewLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LocationBreakdown({ summary }: { summary: Summary }) {
  // Children roll up into their parent: a binder's total should include what is
  // filed in its pages, which is how someone holding the binder sees it.
  const childCounts = new Map(
    summary.locations.map((l) => [l.id, l.instance_count] as const),
  );

  const rows = summary.locations.map((loc) => ({
    ...loc,
    total:
      loc.instance_count +
      loc.children.reduce((sum, child) => sum + (childCounts.get(child.id) ?? 0), 0),
  }));

  const filed = summary.totalCards - summary.unsortedCount;
  const largest = Math.max(1, ...rows.map((r) => r.total), summary.unsortedCount);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Where they live</h2>
        <Link href="/locations" className="text-xs text-accent underline">
          Manage locations
        </Link>
      </div>

      {rows.length === 0 && summary.unsortedCount === 0 ? (
        <EmptyState title="No locations yet.">
          <Link href="/locations" className="text-accent underline">
            Create a binder or box
          </Link>{" "}
          to start filing cards.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-border p-0">
          {rows.map((loc) => (
            <LocationRow
              key={loc.id}
              href={`/collection?location=${loc.id}`}
              name={loc.name}
              type={LOCATION_TYPE_LABELS[loc.type]}
              count={loc.total}
              largest={largest}
            />
          ))}

          {summary.unsortedCount > 0 ? (
            <LocationRow
              href={`/collection?location=${UNSORTED}`}
              name="Unsorted"
              type="Not filed"
              count={summary.unsortedCount}
              largest={largest}
              muted
            />
          ) : null}
        </Card>
      )}

      {rows.length > 0 ? (
        <p className="text-xs text-ink-muted">
          {filed.toLocaleString()} of {summary.totalCards.toLocaleString()} cards filed.
        </p>
      ) : null}
    </section>
  );
}

function LocationRow({
  href,
  name,
  type,
  count,
  largest,
  muted = false,
}: {
  href: string;
  name: string;
  type: string;
  count: number;
  largest: number;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${muted ? "text-ink-muted" : ""}`}
          >
            {name}
          </span>
          <Badge>{type}</Badge>
        </div>

        {/* Proportional bar, scaled to the biggest container rather than to the
            collection total — otherwise every row renders as a sliver. */}
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full ${muted ? "bg-border" : "bg-accent"}`}
            style={{ width: `${Math.max(2, (count / largest) * 100)}%` }}
          />
        </div>
      </div>

      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {count.toLocaleString()}
      </span>
    </Link>
  );
}
