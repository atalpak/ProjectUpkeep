import Link from "next/link";

import { getCurrentUser } from "@/lib/supabase/server";
import {
  getFeed,
  getFriendEdges,
  getMyTosStatus,
  getMyTrades,
  searchProfiles,
} from "@/lib/social/queries";
import { getLocations } from "@/lib/collection/queries";
import { hasAcceptedTos, shouldGateTrading } from "@/lib/social/tos";
import { isExpired } from "@/lib/social/trade-status";
import { FriendsManager } from "@/components/social/FriendsManager";
import { TradeFeed } from "@/components/social/TradeFeed";
import { TradeList } from "@/components/social/TradeList";
import { TradingTerms } from "@/components/social/TradingTerms";
import { PageHeader } from "@/components/ui";
import type { Location } from "@/lib/types";

export const metadata = { title: "Friends · Project Upkeep" };

/**
 * The social hub.
 *
 * One page rather than a Friends tab and a Trades tab, because the two are the
 * same subject: a trade is something that happens with a person. Pending offers
 * sit at the top because they are the only thing here waiting on you.
 */
export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";

  const [user, edges, results, locations, trades, feed, tos] = await Promise.all([
    getCurrentUser(),
    getFriendEdges(),
    searchProfiles(query),
    getLocations(),
    getMyTrades(),
    getFeed(),
    getMyTosStatus(),
  ]);

  // 'countered' is terminal — the counter-offer is its own 'proposed' row — so
  // only 'proposed' trades are still outstanding. Expired ones still show in the
  // list (so they can be dismissed) but no longer count as live.
  const open = trades.filter((t) => t.status === "proposed");
  const settledCount = trades.length - open.length;

  // Offers actually waiting on you: yours to accept, and not timed out.
  const awaitingYou = open.filter(
    (t) => t.recipient_id === user?.id && !isExpired(t),
  ).length;

  const gateTrading = shouldGateTrading(tos);
  const tosAccepted = hasAcceptedTos(tos);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Friends"
        subtitle="Trading happens between friends. Nothing you own is visible to anyone until you both agree and you open a container for trade."
      />

      {gateTrading ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Trading</h2>
          <TradingTerms accepted={false} />
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Outstanding trades
                {open.length > 0 ? ` (${open.length})` : ""}
                {awaitingYou > 0 ? (
                  <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">
                    {awaitingYou} waiting on you
                  </span>
                ) : null}
              </h2>

              {settledCount > 0 ? (
                <Link href="/trades" className="text-xs text-accent underline">
                  Past trades ({settledCount})
                </Link>
              ) : null}
            </div>

            {/* A one-liner rather than the full empty state: this section sits at
                the top of the page, and having nothing pending is the normal case
                rather than something to announce. */}
            {open.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing pending. Offers you send or receive appear here.
              </p>
            ) : (
              <TradeList trades={open} userId={user?.id ?? ""} />
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Activity</h2>
            <TradeFeed entries={feed} userId={user?.id ?? ""} />
          </section>

          {tosAccepted ? <TradingTerms accepted /> : null}
        </>
      )}

      <FriendsManager
        friends={edges.friends}
        incoming={edges.incoming}
        outgoing={edges.outgoing}
        results={results}
        query={query}
        locations={locations as Array<Location & { is_tradable?: boolean }>}
      />
    </div>
  );
}
