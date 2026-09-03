"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptTrade, closeTrade } from "@/app/(app)/trades/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { Price } from "@/components/PriceToggle";
import { Badge, Banner, Button, Card as Panel, EmptyState } from "@/components/ui";
import { displayPrice } from "@/lib/collection/pricing";
import { TRADE_STATUS_LABELS, type TradeDetail } from "@/lib/social/types";
import { expiryLabel, isExpired } from "@/lib/social/trade-status";

type TradeSideItem = TradeDetail["items"][number];

/**
 * Your trades, open and settled.
 *
 * Accepting is the only irreversible thing on this page — it moves cards
 * between two collections — so it says exactly what will happen before you
 * press it, and the button that does it is the only primary one.
 */
export function TradeList({ trades, userId }: { trades: TradeDetail[]; userId: string }) {
  const [state, accept, accepting] = useActionState(acceptTrade, EMPTY_SOCIAL_STATE);

  if (trades.length === 0) {
    return (
      <EmptyState title="No trades yet.">
        Open a friend&rsquo;s trade binder and put an offer together.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      {trades.map((trade) => (
        <TradeCard
          key={trade.id}
          trade={trade}
          userId={userId}
          accept={accept}
          accepting={accepting}
        />
      ))}
    </div>
  );
}

function TradeCard({
  trade,
  userId,
  accept,
  accepting,
}: {
  trade: TradeDetail;
  userId: string;
  accept: (formData: FormData) => void;
  accepting: boolean;
}) {
  const iProposed = trade.proposer_id === userId;
  const other = iProposed ? trade.recipient : trade.proposer;
  // 'countered' is terminal: a counter-offer is a new proposal that supersedes
  // this one, so only 'proposed' is still actionable here.
  const proposed = trade.status === "proposed";
  const expired = isExpired(trade);
  // Still open to accept/counter only while proposed AND not timed out.
  const open = proposed && !expired;
  const wasCountered = trade.status === "countered";
  const timeLeft = expiryLabel(trade.expires_at);

  // What each side gives up, from the signed-in user's point of view.
  const givingUp = trade.items.filter((i) =>
    iProposed ? i.direction === "from_proposer" : i.direction === "from_recipient",
  );
  const receiving = trade.items.filter((i) =>
    iProposed ? i.direction === "from_recipient" : i.direction === "from_proposer",
  );

  const count = (items: typeof givingUp) => items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            {iProposed ? "You offered" : "Offer from"} {other?.username ?? "someone"}
          </h2>
          <p className="text-xs text-ink-muted">
            {new Date(trade.created_at).toLocaleDateString()} · {count(givingUp)} for{" "}
            {count(receiving)}
            {proposed && timeLeft ? (
              <span className={expired ? " text-danger" : ""}> · {timeLeft}</span>
            ) : null}
          </p>
        </div>

        <Badge>{expired && proposed ? "Expired" : TRADE_STATUS_LABELS[trade.status]}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ItemColumn title="You give" items={givingUp} />
        <ItemColumn title="You get" items={receiving} />
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {/* Only the recipient may accept; the database enforces that too. */}
          {!iProposed ? (
            <form action={accept}>
              <input type="hidden" name="trade_id" value={trade.id} />
              <Button type="submit" disabled={accepting}>
                {accepting ? "Completing…" : "Accept and swap cards"}
              </Button>
            </form>
          ) : null}

          <form action={closeTrade}>
            <input type="hidden" name="trade_id" value={trade.id} />
            <input type="hidden" name="as_proposer" value={String(iProposed)} />
            <Button variant="secondary" type="submit" className="text-xs">
              {iProposed ? "Cancel offer" : "Decline"}
            </Button>
          </form>

          {/* Counter: hand the offer back changed. It opens the same proposal
              builder on their profile, pre-filled with this trade mirrored, and
              submitting it supersedes this one. */}
          {!iProposed && other?.username ? (
            <Link
              href={`/u/${encodeURIComponent(other.username)}?counter=${trade.id}`}
              className="text-xs text-accent underline"
            >
              Counter
            </Link>
          ) : null}

          {!iProposed ? (
            <p className="text-xs text-ink-muted">
              Accepting moves these cards between your collections straight away.
            </p>
          ) : null}
        </div>
      ) : null}

      {proposed && expired ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <p className="text-xs text-danger">
            This offer expired and can no longer be accepted.
          </p>
          <form action={closeTrade}>
            <input type="hidden" name="trade_id" value={trade.id} />
            <input type="hidden" name="as_proposer" value={String(iProposed)} />
            <Button variant="secondary" type="submit" className="text-xs">
              Dismiss
            </Button>
          </form>
          {!iProposed && other?.username ? (
            <Link
              href={`/u/${encodeURIComponent(other.username)}?counter=${trade.id}`}
              className="text-xs text-accent underline"
            >
              Make a fresh offer
            </Link>
          ) : null}
        </div>
      ) : null}

      {wasCountered ? (
        <p className="border-t border-border pt-3 text-xs text-ink-muted">
          {iProposed
            ? `${other?.username ?? "They"} countered this with a new offer.`
            : "You countered this offer. Your new proposal replaces it."}
        </p>
      ) : null}
    </Panel>
  );
}

/** Value of one side, priced by the snapshot finish. Null when nothing priced. */
function sideValue(items: TradeSideItem[]): number | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    const unit = displayPrice(item.card, item.finish ?? "nonfoil").value;
    if (unit !== null) {
      total += unit * item.quantity;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

function ItemColumn({ title, items }: { title: string; items: TradeSideItem[] }) {
  const value = sideValue(items);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-muted">{title}</h3>
        <Price value={value} className="text-xs text-ink-muted" />
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: TradeSideItem }) {
  // The snapshot is the identity; the live instance only adds nothing new here.
  const card = item.card;
  const preview = useCardPreview(card);
  const dp = displayPrice(card, item.finish ?? "nonfoil");

  return (
    <li className="flex items-center gap-1.5 text-sm">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {item.quantity}
      </span>
      <span
        {...preview}
        tabIndex={0}
        className="min-w-0 flex-1 cursor-default truncate hover:underline"
      >
        {card?.name ?? "a card"}
      </span>
      {item.finish && item.finish !== "nonfoil" ? <FoilMark finish={item.finish} /> : null}
      <Price
        value={dp.value}
        approximate={dp.approximate}
        className="shrink-0 text-xs text-ink-muted"
      />
    </li>
  );
}
