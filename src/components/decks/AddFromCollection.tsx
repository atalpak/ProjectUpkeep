"use client";

import { useActionState, useState } from "react";

import { addToDeck } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { useCardPreview } from "@/components/CardPanel";
import { Badge, Banner, Button, Input, Select } from "@/components/ui";
import { availabilityFor, type Availability } from "@/lib/collection/availability";
import { CONDITION_LABELS, FINISH_LABELS, type CardInstanceWithCard } from "@/lib/types";

/**
 * "Add from my collection".
 *
 * Shows only stacks that are actually free — anything already sleeved in a deck
 * is excluded by the query, because moving a card from one deck to another is a
 * transfer and should be asked for on purpose rather than happening by accident
 * here.
 *
 * Each row says how many copies of that card you own and how many are free, so
 * the answer to "can I put a fourth Bolt in this deck" is on screen before you
 * click anything.
 */
export function AddFromCollection({
  deckId,
  stacks,
  availability,
  search,
  onSearch,
}: {
  deckId: string;
  stacks: CardInstanceWithCard[];
  availability: Map<string, Availability>;
  search: string;
  onSearch: (value: string) => void;
}) {
  const [state, action, pending] = useActionState(addToDeck, EMPTY_DECK_STATE);

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search your available cards"
        aria-label="Search your available cards"
      />

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      {stacks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          {search.trim()
            ? "Nothing available matches that."
            : "Every copy you own is already in a deck."}
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {stacks.map((stack) => (
            <StackRow
              key={stack.id}
              deckId={deckId}
              stack={stack}
              availability={availabilityFor(availability, stack.cards)}
              action={action}
              pending={pending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StackRow({
  deckId,
  stack,
  availability,
  action,
  pending,
}: {
  deckId: string;
  stack: CardInstanceWithCard;
  availability: Availability;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const card = stack.cards;
  const preview = useCardPreview(card);
  const [quantity, setQuantity] = useState(1);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <span
          {...preview}
          tabIndex={0}
          className="cursor-default text-sm font-medium hover:underline"
        >
          {card?.name ?? "Unknown printing"}
        </span>

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
          <span>
            {card?.set_name ?? card?.set_code?.toUpperCase()} #{card?.collector_number}
          </span>
          <Badge>{CONDITION_LABELS[stack.condition] ?? stack.condition}</Badge>
          <Badge>{FINISH_LABELS[stack.finish] ?? stack.finish}</Badge>
          <span>in {stack.locations?.name ?? "Unsorted"}</span>
        </div>
      </div>

      <div className="text-right text-xs">
        <div className="font-medium tabular-nums">
          {availability.available} of {availability.total} free
        </div>
        {availability.inDecks > 0 ? (
          <div className="text-ink-muted tabular-nums">{availability.inDecks} in decks</div>
        ) : null}
      </div>

      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="deck_id" value={deckId} />
        <input type="hidden" name="instance_id" value={stack.id} />

        {/* Capped at this stack's own size: availability is counted across every
            printing, but you can only take copies out of the stack in hand. */}
        <Select
          name="quantity"
          value={String(quantity)}
          onChange={(e) => setQuantity(Number(e.target.value))}
          aria-label={`Copies of ${card?.name ?? "this card"} to add`}
          className="w-16 text-xs"
        >
          {Array.from({ length: stack.quantity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>

        <Button type="submit" variant="secondary" disabled={pending} className="text-xs">
          Add
        </Button>
      </form>
    </li>
  );
}
