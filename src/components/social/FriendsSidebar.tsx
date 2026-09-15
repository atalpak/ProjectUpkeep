import { PastTradesLink } from "@/components/social/PastTradesLink";
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
 *
 * An outstanding trade is not its own section any more. Nothing pending is
 * the normal state of this page, so a permanent "Outstanding trades" heading
 * (even one that only ever said "nothing pending") was a fixture announcing
 * an absence on every visit. Instead it is a pinned tile at the top of
 * Activity — appearing only while a trade is actually open, gone the moment
 * it is accepted or closed — and settled trades move behind a small "View
 * past trades" link beside the Activity heading, opening a popup, rather
 * than sitting in an always-present `<details>` panel.
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Activity</h2>
          <PastTradesLink
            trades={settled}
            userId={userId}
            highlightId={highlightId}
            defaultOpen={highlightInSettled}
          />
        </div>

        {/* Pinned above the feed only while something is actually open —
            gone the instant it is accepted or closed, not a fixture that
            spends most of its life announcing there is nothing pending. */}
        {open.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
            <h3 className="text-xs font-semibold text-ink-muted">
              Outstanding trade{open.length > 1 ? "s" : ""} ({open.length})
              {awaitingYou > 0 ? (
                <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">
                  {awaitingYou} waiting on you
                </span>
              ) : null}
            </h3>
            <TradeList trades={open} userId={userId} highlightId={highlightId} />
          </div>
        ) : null}

        <TradeFeed entries={feed} userId={userId} />
      </section>

      {tosAccepted ? <TradingTerms accepted /> : null}
    </aside>
  );
}
