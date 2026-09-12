import { TradeFeed } from "@/components/social/TradeFeed";
import { TradeList } from "@/components/social/TradeList";
import { TradingTerms } from "@/components/social/TradingTerms";
import type { FeedEntry, TradeDetail } from "@/lib/social/types";

/**
 * The left rail: what is waiting on you, then what has already happened.
 *
 * Laid out like a feed — most-actionable first, history below it — because
 * trades and activity are the *ongoing* half of a friendship, distinct from
 * the roster of who your friends even are. That roster is the main column;
 * this is the thing worth checking on every visit, so it sits where a feed
 * usually sits: to one side, always in view, never the whole page.
 *
 * On a narrow screen there is no "side" — this renders second, between the
 * search box and the friends list, rather than only ever appearing on a wide
 * layout (see `.claude/rules/app-router.md` on standing-at-a-table use).
 */
export function FriendsSidebar({
  gateTrading,
  tosAccepted,
  open,
  settled,
  feed,
  userId,
  highlightId,
  highlightInSettled,
  awaitingYou,
}: {
  gateTrading: boolean;
  tosAccepted: boolean;
  open: TradeDetail[];
  settled: TradeDetail[];
  feed: FeedEntry[];
  userId: string;
  highlightId?: string;
  highlightInSettled: boolean;
  /** Offers waiting on you specifically — yours to accept, not timed out. */
  awaitingYou: number;
}) {
  if (gateTrading) {
    return (
      <aside className="space-y-3">
        <h2 className="text-sm font-semibold">Trading</h2>
        <TradingTerms accepted={false} />
      </aside>
    );
  }

  return (
    <aside className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Outstanding trades
          {open.length > 0 ? ` (${open.length})` : ""}
          {awaitingYou > 0 ? (
            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">
              {awaitingYou} waiting on you
            </span>
          ) : null}
        </h2>

        {/* A one-liner rather than the full empty state: this section sits at
            the top of the page, and having nothing pending is the normal case
            rather than something to announce. */}
        {open.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing pending. Offers you send or receive appear here.
          </p>
        ) : (
          <TradeList trades={open} userId={userId} highlightId={highlightId} />
        )}

        {settled.length > 0 ? (
          <details className="rounded-lg border border-border" open={highlightInSettled}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Past trades ({settled.length})
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <TradeList trades={settled} userId={userId} highlightId={highlightId} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <TradeFeed entries={feed} userId={userId} />
      </section>

      {tosAccepted ? <TradingTerms accepted /> : null}
    </aside>
  );
}
