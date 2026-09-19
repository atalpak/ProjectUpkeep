/**
 * Turning a notification row into something to read.
 *
 * Pure, so the wording is in one place and tested, not scattered through JSX.
 * `notificationHref` stays in the web app: it is a web route, not a product rule.
 */

export const NOTIFICATION_TYPES = [
  "trade_proposed",
  "trade_accepted",
  "trade_declined",
  "trade_cancelled",
  "trade_countered",
  "friend_request",
  "friend_accepted",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The sentence shown in the inbox, given who did it. */
export function notificationSentence(type: NotificationType, actor: string): string {
  switch (type) {
    case "trade_proposed":
      return `${actor} sent you a trade offer.`;
    case "trade_countered":
      return `${actor} countered your offer with a new one.`;
    case "trade_accepted":
      return `${actor} accepted your trade. The cards have moved.`;
    case "trade_declined":
      return `${actor} declined your trade offer.`;
    case "trade_cancelled":
      return `${actor} cancelled a trade offer.`;
    case "friend_request":
      return `${actor} sent you a friend request.`;
    case "friend_accepted":
      return `${actor} accepted your friend request.`;
  }
}

/** A compact relative time: "just now", "3h ago", "2d ago", or a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
