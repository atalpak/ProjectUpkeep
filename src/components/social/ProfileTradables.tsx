"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { ManaCost } from "@/components/ManaCost";
import { TradeBuilder } from "@/components/social/TradeBuilder";
import { Badge, Button, Card as Panel, EmptyState, Input } from "@/components/ui";
import { CONDITION_LABELS, type CardInstanceWithCard } from "@/lib/types";

/**
 * Someone's trade binder, and the way into a trade.
 *
 * Browsing comes first and proposing is a deliberate second step. Most visits
 * to a profile are to see what somebody has, not to make an offer, and opening
 * on a two-column trade form asks a question the visitor has not got to yet.
 */
export function ProfileTradables({
  recipientId,
  recipientName,
  theirCards,
  myCards,
  tosAccepted = true,
  counterOf,
  initialRequesting,
  initialOffering,
  startTrading = false,
}: {
  recipientId: string;
  recipientName: string;
  theirCards: CardInstanceWithCard[];
  myCards: CardInstanceWithCard[];
  /** Whether the viewer has accepted the trading terms. Gates proposing. */
  tosAccepted?: boolean;
  /** When countering an offer: the trade being replaced, and its cards mirrored. */
  counterOf?: string;
  initialRequesting?: Record<string, number>;
  initialOffering?: Record<string, number>;
  /** Open straight into the builder (used when arriving to counter an offer). */
  startTrading?: boolean;
}) {
  const [trading, setTrading] = useState(startTrading && tosAccepted);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return theirCards;
    return theirCards.filter((r) => (r.cards?.name ?? "").toLowerCase().includes(needle));
  }, [theirCards, search]);

  const totalCards = theirCards.reduce((sum, r) => sum + r.quantity, 0);

  if (trading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {counterOf
              ? `Countering ${recipientName}'s offer`
              : `Building an offer for ${recipientName}`}
          </h2>
          <Button variant="secondary" type="button" onClick={() => setTrading(false)}>
            Back to their binder
          </Button>
        </div>

        <TradeBuilder
          recipientId={recipientId}
          recipientName={recipientName}
          theirCards={theirCards}
          myCards={myCards}
          counterOf={counterOf}
          initialRequesting={initialRequesting}
          initialOffering={initialOffering}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {totalCards} card{totalCards === 1 ? "" : "s"} open for trade
        </p>

        {tosAccepted ? (
          <Button
            type="button"
            onClick={() => setTrading(true)}
            disabled={theirCards.length === 0}
          >
            Propose a trade
          </Button>
        ) : (
          <Link href="/friends" className="text-xs text-accent underline">
            Accept the trading terms to propose a trade
          </Link>
        )}
      </div>

      {counterOf && !tosAccepted ? (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          Accept the trading terms on the friends page, then use the Counter link again.
        </p>
      ) : null}

      {myCards.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          You have nothing open for trade yet, so you can only ask for cards rather than offer
          any. Mark a binder as tradable on the friends page to put something up.
        </p>
      ) : null}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter their binder"
        aria-label="Filter their binder"
      />

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches that." />
      ) : (
        <Panel className="divide-y divide-border p-0">
          {rows.map((row) => (
            <TradableRow key={row.id} row={row} />
          ))}
        </Panel>
      )}
    </div>
  );
}

function TradableRow({ row }: { row: CardInstanceWithCard }) {
  const card = row.cards;
  const preview = useCardPreview(card);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {row.quantity}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            {...preview}
            tabIndex={0}
            className="cursor-default truncate text-sm font-medium hover:underline"
          >
            {card?.name ?? "Unknown printing"}
          </span>
          <FoilMark finish={row.finish} />
          <ManaCost cost={card?.mana_cost} size="xs" />
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
          <span>{card?.set_name ?? card?.set_code?.toUpperCase()}</span>
          <Badge>{CONDITION_LABELS[row.condition] ?? row.condition}</Badge>
          <span>in {row.locations?.name ?? "their binder"}</span>
        </div>
      </div>
    </div>
  );
}
