"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { ManaCost } from "@/components/ManaCost";
import { TradeBuilder } from "@/components/social/TradeBuilder";
import { Badge, Button, Card as Panel, EmptyState, Input, cx } from "@/components/ui";
import { CONDITION_LABELS, type CardInstanceWithCard } from "@/lib/types";

type BinderView = "list" | "gallery";

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
  const [view, setView] = useState<BinderView>("list");

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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter their binder"
          aria-label="Filter their binder"
          className="min-w-48 flex-1"
        />
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {(["list", "gallery"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={cx(
                "px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === option ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
              )}
            >
              {option === "list" ? "List" : "Images"}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches that." />
      ) : view === "gallery" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((row) => (
            <GalleryTradable key={row.id} row={row} />
          ))}
        </ul>
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

function GalleryTradable({ row }: { row: CardInstanceWithCard }) {
  const card = row.cards;
  const preview = useCardPreview(card);
  const image = card?.image_uri ?? card?.image_uri_small;

  return (
    <li className="space-y-1">
      <div
        {...preview}
        tabIndex={0}
        className="relative aspect-[488/680] cursor-default overflow-hidden rounded-lg border border-border bg-surface-muted"
      >
        {image ? (
          <Image
            src={image}
            alt={card?.name ?? "Card"}
            fill
            sizes="(min-width: 1280px) 12rem, (min-width: 640px) 25vw, 45vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-ink-muted">
            {card?.name ?? "No image"}
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {row.quantity}×
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <span className="min-w-0 truncate text-ink-muted">{card?.name ?? "Unknown"}</span>
        <FoilMark finish={row.finish} />
      </div>
    </li>
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
