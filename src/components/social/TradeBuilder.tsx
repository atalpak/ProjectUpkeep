"use client";

import { useActionState, useMemo, useState } from "react";

import { proposeTrade } from "@/app/(app)/trades/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { useCardPreview } from "@/components/CardPanel";
import { FoilMark } from "@/components/FoilMark";
import { ManaCost } from "@/components/ManaCost";
import { Price, PriceToggle } from "@/components/PriceToggle";
import { displayPrice } from "@/lib/collection/pricing";
import { Badge, Banner, Button, Card as Panel, EmptyState, Input, cx } from "@/components/ui";
import { CONDITION_LABELS, type CardInstanceWithCard } from "@/lib/types";

/**
 * Building an offer.
 *
 * Two columns: what you are asking for from their trade binder, and what you
 * are putting up from yours. Both sides are picked here, by the proposer, which
 * is how a trade offer works — the recipient's job is to say yes or no to a
 * concrete thing rather than to negotiate a blank form.
 *
 * The selection is kept as a plain map and submitted as two encoded fields.
 * That keeps the whole proposal one form submission, so a half-built trade can
 * never reach the database.
 */

type Selection = Record<string, number>;

export function TradeBuilder({
  recipientId,
  recipientName,
  theirCards,
  myCards,
  counterOf,
  initialRequesting,
  initialOffering,
}: {
  recipientId: string;
  recipientName: string;
  theirCards: CardInstanceWithCard[];
  myCards: CardInstanceWithCard[];
  /** Set when this proposal replaces one the user received. */
  counterOf?: string;
  /** Pre-selected cards, keyed by card_instance id, for a counter-offer. */
  initialRequesting?: Selection;
  initialOffering?: Selection;
}) {
  const [state, propose, proposing] = useActionState(proposeTrade, EMPTY_SOCIAL_STATE);

  const [requesting, setRequesting] = useState<Selection>(initialRequesting ?? {});
  const [offering, setOffering] = useState<Selection>(initialOffering ?? {});
  const [theirSearch, setTheirSearch] = useState("");
  const [mySearch, setMySearch] = useState("");

  const encode = (selection: Selection) =>
    Object.entries(selection)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => `${id}:${quantity}`)
      .join(",");

  const countOf = (selection: Selection) =>
    Object.values(selection).reduce((sum, n) => sum + n, 0);

  const filter = (rows: CardInstanceWithCard[], term: string) => {
    const needle = term.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => (r.cards?.name ?? "").toLowerCase().includes(needle));
  };

  const theirs = useMemo(() => filter(theirCards, theirSearch), [theirCards, theirSearch]);
  const mine = useMemo(() => filter(myCards, mySearch), [myCards, mySearch]);

  const nothingSelected = countOf(requesting) === 0 && countOf(offering) === 0;

  return (
    <form action={propose} className="space-y-4">
      <input type="hidden" name="recipient_id" value={recipientId} />
      <input type="hidden" name="requesting" value={encode(requesting)} />
      <input type="hidden" name="offering" value={encode(offering)} />
      {counterOf ? <input type="hidden" name="counter_of" value={counterOf} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title={`You want from ${recipientName}`}
          empty={`${recipientName} has nothing open for trade.`}
          rows={theirs}
          selection={requesting}
          onChange={setRequesting}
          search={theirSearch}
          onSearch={setTheirSearch}
        />

        <Side
          title="You are offering"
          empty="You have no containers open for trade yet."
          rows={mine}
          selection={offering}
          onChange={setOffering}
          search={mySearch}
          onSearch={setMySearch}
        />
      </div>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      <div className="flex flex-wrap items-center gap-3">
        <PriceToggle />

        <Button type="submit" disabled={proposing || nothingSelected}>
          {proposing
            ? counterOf
              ? "Sending…"
              : "Proposing…"
            : `${counterOf ? "Send counter-offer" : "Propose trade"} (${countOf(offering)} for ${countOf(
                requesting,
              )})`}
        </Button>

        <p className="text-xs text-ink-muted">
          {counterOf ? "This replaces their earlier offer. " : ""}Nothing moves until{" "}
          {recipientName} accepts. Then both collections update at once.
        </p>
      </div>
    </form>
  );
}

function Side({
  title,
  empty,
  rows,
  selection,
  onChange,
  search,
  onSearch,
}: {
  title: string;
  empty: string;
  rows: CardInstanceWithCard[];
  selection: Selection;
  onChange: (next: Selection) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  function setQuantity(id: string, quantity: number) {
    const next = { ...selection };
    if (quantity <= 0) delete next[id];
    else next[id] = quantity;
    onChange(next);
  }

  return (
    <Panel className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>

      {rows.length === 0 && search.trim() === "" ? (
        <EmptyState title={empty} />
      ) : (
        <>
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter by name"
            aria-label={`Filter ${title}`}
          />

          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {rows.map((row) => (
              <OfferRow
                key={row.id}
                row={row}
                quantity={selection[row.id] ?? 0}
                onQuantity={(q) => setQuantity(row.id, q)}
              />
            ))}
            {rows.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-ink-muted">
                Nothing matches that.
              </li>
            ) : null}
          </ul>
        </>
      )}
    </Panel>
  );
}

function OfferRow({
  row,
  quantity,
  onQuantity,
}: {
  row: CardInstanceWithCard;
  quantity: number;
  onQuantity: (quantity: number) => void;
}) {
  const card = row.cards;
  const preview = useCardPreview(card);
  const selected = quantity > 0;

  return (
    <li className={cx("flex items-center gap-2 px-3 py-2", selected && "bg-accent-soft")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span {...preview} tabIndex={0} className="cursor-default truncate text-sm hover:underline">
            {card?.name ?? "Unknown printing"}
          </span>
          <FoilMark finish={row.finish} />
          <ManaCost cost={card?.mana_cost} size="xs" />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
          <span>{card?.set_name ?? card?.set_code?.toUpperCase()}</span>
          <Badge>{CONDITION_LABELS[row.condition] ?? row.condition}</Badge>
          <span>{row.quantity} available</span>
          {(() => {
            const dp = displayPrice(card, row.finish);
            return <Price value={dp.value} approximate={dp.approximate} className="text-[11px]" />;
          })()}
        </div>
      </div>

      {/* A stepper rather than a number box: offers are one or two copies far
          more often than seven, and this keeps it to one click. */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onQuantity(Math.max(0, quantity - 1))}
          disabled={quantity === 0}
          aria-label={`One fewer ${card?.name ?? "card"}`}
          className="size-6 rounded border border-border text-xs disabled:opacity-40 coarse:size-9"
        >
          −
        </button>
        <span className="w-5 text-center text-xs tabular-nums">{quantity}</span>
        <button
          type="button"
          onClick={() => onQuantity(Math.min(row.quantity, quantity + 1))}
          disabled={quantity >= row.quantity}
          aria-label={`One more ${card?.name ?? "card"}`}
          className="size-6 rounded border border-border text-xs disabled:opacity-40 coarse:size-9"
        >
          +
        </button>
      </div>
    </li>
  );
}
