/**
 * Turning a notification row into something to read and somewhere to go.
 *
 * Pure, so the wording is in one place and tested, not scattered through JSX.
 */

import type { NotificationType } from "@/lib/social/types";

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

/**
 * Where clicking a notification should land.
 *
 * Everything trade-related lives on the friends page (open offers) or, once
 * settled, the past-trades archive — there is no per-trade page — so that is
 * where these point. Accepted, declined and cancelled are done; the rest are
 * still on the friends page waiting for a response.
 */
export function notificationHref(type: NotificationType): string {
  switch (type) {
    case "trade_accepted":
    case "trade_declined":
    case "trade_cancelled":
      return "/trades";
    case "trade_proposed":
    case "trade_countered":
    case "friend_request":
    case "friend_accepted":
      return "/friends";
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
