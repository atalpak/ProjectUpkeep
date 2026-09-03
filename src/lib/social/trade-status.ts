/**
 * How long a trade offer has left.
 *
 * A proposal is made with a 14-day fuse (see EXPIRY_DAYS). Past that it can no
 * longer be accepted — accept_trade() refuses, and the list shows it as spent.
 * The expiry is derived from expires_at, never stored as a status, so this is
 * the one place that turns the timestamp into something to show.
 */

/** Days from proposal to expiry. Also used by the propose action to set it. */
export const EXPIRY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

type WithExpiry = { expires_at: string | null; status?: string };

/**
 * Is this proposal past its expiry?
 *
 * Only meaningful while a trade is still open; a completed or declined trade is
 * never "expired", whatever its timestamp says. A null expires_at (every trade
 * from before the feature) never expires.
 */
export function isExpired(trade: WithExpiry, now: number = Date.now()): boolean {
  if (trade.status !== undefined && trade.status !== "proposed") return false;
  if (!trade.expires_at) return false;
  return new Date(trade.expires_at).getTime() <= now;
}

/** Whole days between now and `when` (negative when `when` is in the past). */
function daysUntil(when: string, now: number): number {
  return Math.ceil((new Date(when).getTime() - now) / DAY_MS);
}

/**
 * A short phrase for how much time is left, or null when there is no expiry to
 * talk about.
 */
export function expiryLabel(
  expires_at: string | null,
  now: number = Date.now(),
): string | null {
  if (!expires_at) return null;

  const remaining = new Date(expires_at).getTime() - now;
  if (remaining <= 0) {
    const daysAgo = -daysUntil(expires_at, now);
    if (daysAgo <= 0) return "Expired";
    return `Expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  }

  const days = daysUntil(expires_at, now);
  if (days <= 1) return "Expires today";
  if (days === 2) return "Expires tomorrow";
  if (days <= 7) return `Expires in ${days} days`;
  return `Expires ${new Date(expires_at).toLocaleDateString()}`;
}

/** True when expiry is close enough to be worth flagging (≤ 2 days). */
export function expiringSoon(
  expires_at: string | null,
  now: number = Date.now(),
): boolean {
  if (!expires_at) return false;
  const remaining = new Date(expires_at).getTime() - now;
  return remaining > 0 && remaining <= 2 * DAY_MS;
}

/** The ISO instant a proposal made now should expire at. */
export function expiryFromNow(now: number = Date.now()): string {
  return new Date(now + EXPIRY_DAYS * DAY_MS).toISOString();
}
