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
import { FriendSearch } from "@/components/social/FriendSearch";
import { FriendsManager } from "@/components/social/FriendsManager";
import { FriendsSidebar } from "@/components/social/FriendsSidebar";
import { PageHeader } from "@/components/ui";
import type { Location } from "@/lib/types";

export const metadata = { title: "Friends · Project Upkeep" };

/**
 * The social hub.
 *
 * One page rather than a Friends tab and a Trades tab, because the two are the
 * same subject: a trade is something that happens with a person. Search leads
 * the page because everything else is downstream of having added someone;
 * trades and activity sit in a sidebar because they are the ongoing half of a
 * friendship, checked on every visit rather than browsed once. On a narrow
 * screen there is no "side" — search, then sidebar, then roster, stacked in
 * that order (see `.claude/rules/app-router.md`).
 */
export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; trade?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  // A trade notification links here with ?trade=<id> (see
  // src/lib/social/notifications.ts) when the offer it is about is still
  // outstanding, so it can be picked out among everything else pending.
  const highlightId = Array.isArray(params.trade) ? params.trade[0] : params.trade;

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
  const settled = trades.filter((t) => t.status !== "proposed");

  // The notification link (?trade=) can point at a trade that has since
  // settled. If it does, the <details> holding it has to render open, or the
  // highlight this link exists for is hidden behind a click.
  const highlightInSettled =
    highlightId !== undefined && settled.some((t) => t.id === highlightId);

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

      <FriendSearch results={results} query={query} />

      {/* Sidebar first in the DOM: on a narrow screen this stacks between the
          search box above and the roster below, exactly the order it takes on
          a wide one where it becomes the left column instead. */}
      <div className="grid gap-8 lg:grid-cols-[320px_1fr] lg:items-start">
        <FriendsSidebar
          gateTrading={gateTrading}
          tosAccepted={tosAccepted}
          open={open}
          settled={settled}
          feed={feed}
          userId={user?.id ?? ""}
          highlightId={highlightId}
          highlightInSettled={highlightInSettled}
          awaitingYou={awaitingYou}
        />

        <FriendsManager
          friends={edges.friends}
          incoming={edges.incoming}
          outgoing={edges.outgoing}
          locations={locations as Array<Location & { is_tradable?: boolean }>}
        />
      </div>
    </div>
  );
}
