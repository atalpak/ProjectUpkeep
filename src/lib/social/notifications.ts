/**
 * Notification wording moved to `packages/upkeep-domain/src/notifications.ts`
 * so mobile can share it; this file re-exports it and keeps the one piece that
 * is a web route.
 */

import type { NotificationType } from "@upkeep/domain";

export { notificationSentence, relativeTime } from "@upkeep/domain";

/**
 * Where clicking a notification should land.
 *
 * Everything social — trades, open or settled, and friend requests — lives on
 * the friends page; there is no separate trades page and no per-trade page.
 *
 * When the row names a `trade_id`, the link carries it as a `?trade=` query
 * param — the same shape `/collection?location=` and `/u/[username]?counter=`
 * already use for "land here, then pick out this one thing" — so the friends
 * page can highlight and scroll to it instead of leaving you to find it among
 * everything else there.
 */
export function notificationHref(
  // `type` no longer changes the destination — every NotificationType lands
  // on /friends now, trades open or settled alike — but it stays a parameter
  // so callers keep passing it and this signature is the one place that
  // would need to change if a type ever needed its own page again.
  _type: NotificationType,
  tradeId?: string | null,
): string {
  return tradeId ? `/friends?trade=${encodeURIComponent(tradeId)}` : "/friends";
}
