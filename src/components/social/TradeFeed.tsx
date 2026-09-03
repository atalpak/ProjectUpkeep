import Link from "next/link";

import { Card as Panel, EmptyState } from "@/components/ui";
import type { FeedEntry } from "@/lib/social/types";

/**
 * The activity feed.
 *
 * Deliberately reads like a Venmo line rather than a table: who traded with
 * whom, what moved, how long ago. The point of a feed is recognising activity
 * at a glance, not auditing it — the trade itself is on the trades page for
 * anyone who wants the detail.
 *
 * Only completed trades appear. A feed of live proposals would broadcast
 * negotiations that have not happened and might never.
 */

export function TradeFeed({ entries, userId }: { entries: FeedEntry[]; userId: string }) {
  if (entries.length === 0) {
    return (
      <EmptyState title="Nothing has happened yet.">
        Completed trades between you and your friends show up here.
      </EmptyState>
    );
  }

  return (
    <Panel className="divide-y divide-border p-0">
      {entries.map((entry) => (
        <FeedRow key={entry.trade.id} entry={entry} userId={userId} />
      ))}
    </Panel>
  );
}

/** "3 minutes ago" — precise enough for a feed, no dependency needed. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
  ];

  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";

  for (const [size, nextUnit] of steps) {
    if (value < size) break;
    value = value / size;
    unit = nextUnit;
  }

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -Math.round(value),
    unit,
  );
}

function FeedRow({ entry, userId }: { entry: FeedEntry; userId: string }) {
  const proposerIsMe = entry.trade.proposer_id === userId;
  const recipientIsMe = entry.trade.recipient_id === userId;

  const name = (
    profile: FeedEntry["proposer"],
    isMe: boolean,
  ) =>
    isMe ? (
      <span className="font-medium">You</span>
    ) : profile ? (
      <Link href={`/u/${profile.username}`} className="font-medium hover:underline">
        {profile.username}
      </Link>
    ) : (
      <span className="font-medium">Someone</span>
    );

  // Up to three names, then a count — the shape of a readable one-liner.
  const summarise = (names: string[], total: number) => {
    if (names.length === 0) return "nothing";
    const shown = names.slice(0, 3).join(", ");
    const extra = total - names.slice(0, 3).length;
    return extra > 0 ? `${shown} +${extra} more` : shown;
  };

  return (
    <article className="px-4 py-3">
      <p className="text-sm">
        {name(entry.proposer, proposerIsMe)}{" "}
        <span className="text-ink-muted">traded with</span>{" "}
        {name(entry.recipient, recipientIsMe)}
      </p>

      <p className="mt-1 text-xs text-ink-muted">
        <span className="text-ink">{summarise(entry.fromProposer, entry.cardsFromProposer)}</span>
        {" → "}
        <span className="text-ink">{summarise(entry.fromRecipient, entry.cardsFromRecipient)}</span>
      </p>

      <p className="mt-1 text-[11px] text-ink-muted">{timeAgo(entry.trade.updated_at)}</p>
    </article>
  );
}
