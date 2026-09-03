/**
 * Types for the social and trading half of the app.
 *
 * Kept apart from lib/types.ts, which describes one person's own collection.
 * Everything here involves two people, and that difference is worth seeing in
 * the import path.
 */

import type { Card, CardInstanceWithCard } from "@/lib/types";

export type Profile = {
  id: string;
  username: string;
  created_at: string;
};

export const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
};

/** A friendship seen from the signed-in user's side. */
export type FriendEdge = {
  friendship: Friendship;
  /** The other person. */
  profile: Profile;
  /** Which way a pending request points. */
  direction: "incoming" | "outgoing";
};

export const TRADE_STATUSES = [
  "proposed",
  "countered",
  "accepted",
  "declined",
  "completed",
  "cancelled",
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  proposed: "Proposed",
  countered: "Countered",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type Trade = {
  id: string;
  proposer_id: string;
  recipient_id: string;
  status: TradeStatus;
  /** The trade this one was proposed to replace, when it is a counter-offer. */
  countered_from: string | null;
  /** When a still-open proposal stops being acceptable. Null = no expiry. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export const TRADE_DIRECTIONS = ["from_proposer", "from_recipient"] as const;
export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];

export type TradeItem = {
  id: string;
  trade_id: string;
  card_instance_id: string;
  direction: TradeDirection;
  quantity: number;
  created_at: string;
  /** Snapshot taken when the item was added (migration 23) — survives the
   *  instance being moved to the other owner on completion. */
  card_id: string | null;
  finish: string | null;
};

/**
 * A trade with everything needed to render it.
 *
 * `card` is the snapshot and is always the right identity; `instance` is the
 * live row and is present only while it is still visible (an open trade, or one
 * the viewer received).
 */
export type TradeDetail = Trade & {
  proposer: Profile | null;
  recipient: Profile | null;
  items: Array<
    TradeItem & { instance: CardInstanceWithCard | null; card: Card | null }
  >;
};

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

export type Notification = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  trade_id: string | null;
  friendship_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** A notification with the acting person's handle resolved, as the inbox renders it. */
export type NotificationDetail = Notification & {
  actor: Profile | null;
};

/**
 * One entry in the activity feed.
 *
 * Built from completed trades rather than from ownership_history: a trade is
 * the event people recognise ("A traded with B"), and the history rows are its
 * individual card movements.
 */
export type FeedEntry = {
  trade: Trade;
  proposer: Profile | null;
  recipient: Profile | null;
  /** Card names moving each way, for the one-line summary. */
  fromProposer: string[];
  fromRecipient: string[];
  cardsFromProposer: number;
  cardsFromRecipient: number;
};
