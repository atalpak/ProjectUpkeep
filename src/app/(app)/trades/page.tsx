import { getCurrentUser } from "@/lib/supabase/server";
import { getMyTrades } from "@/lib/social/queries";
import { TradeList } from "@/components/social/TradeList";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Past trades · Project Upkeep" };

/**
 * Settled trades only.
 *
 * Not in the nav: outstanding offers and the feed live on the friends page,
 * which is where trading starts. This is the archive you follow a link to when
 * you want to check what actually happened.
 */
export default async function PastTradesPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string | string[] }>;
}) {
  const params = await searchParams;
  // A trade notification links here with ?trade=<id> (see
  // src/lib/social/notifications.ts) so the one it is about is picked out of
  // the archive rather than left for you to find among everything else here.
  const highlightId = Array.isArray(params.trade) ? params.trade[0] : params.trade;

  const user = await getCurrentUser();
  const trades = await getMyTrades();
  // 'countered' is terminal now (superseded by a fresh proposal), so it belongs
  // in the archive alongside declined and cancelled.
  const settled = trades.filter((t) => t.status !== "proposed");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Past trades"
        subtitle="Everything that has been completed, declined or cancelled."
        backHref="/friends"
        backLabel="Friends"
      />

      <TradeList trades={settled} userId={user?.id ?? ""} highlightId={highlightId} />
    </div>
  );
}
