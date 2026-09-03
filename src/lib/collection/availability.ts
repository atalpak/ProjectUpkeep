/**
 * Which copies are free to put in a deck.
 *
 * The thing every other collection tool gets wrong: owning four Lightning Bolts
 * tells you nothing useful if three of them are already sleeved in a Commander
 * deck. What a deckbuilder needs is the *available* count, and that is a
 * derived number, not a stored one.
 *
 * A deck is a physical container — `locations.type = 'deck'` — so the rule is
 * simply: a copy is committed if it sits in a deck, and available otherwise.
 * Unsorted counts as available; so do binders and boxes. There is no separate
 * reservation state to keep honest, which is the whole reason the model stays
 * trustworthy.
 *
 * Availability is counted per *card*, not per printing, because that is how
 * decks work — any printing of Lightning Bolt is a Lightning Bolt. Scryfall's
 * `oracle_id` is shared by every printing of the same card, which makes it the
 * natural key. Cards missing one fall back to their name.
 */

import type { CardInstanceWithCard, LocationType } from "@/lib/types";

/** The one location type that makes a copy unavailable. */
export const COMMITTED_LOCATION_TYPE: LocationType = "deck";

export type Availability = {
  /** Every copy owned, wherever it is. */
  total: number;
  /** Copies sleeved into a deck. */
  inDecks: number;
  /** Copies free to put in a deck. */
  available: number;
};

export const ZERO_AVAILABILITY: Availability = { total: 0, inDecks: 0, available: 0 };

/** The minimum a row needs for counting. Keeps the query narrow. */
export type CountableRow = {
  quantity: number;
  cards: { oracle_id: string | null; name: string } | null;
  locations: { type: LocationType } | null;
};

/**
 * Groups every printing of a card under one key.
 *
 * `oracle_id` is stable across printings and reprints, which is exactly the
 * grouping a deck wants. Name is the fallback for the rare row that has no
 * oracle id, and is good enough: two different cards sharing a name would have
 * to be a Scryfall data error.
 */
export function cardKey(card: { oracle_id: string | null; name: string } | null): string | null {
  if (!card) return null;
  return card.oracle_id ?? `name:${card.name.toLowerCase()}`;
}

export function computeAvailability(rows: CountableRow[]): Map<string, Availability> {
  const byCard = new Map<string, Availability>();

  for (const row of rows) {
    const key = cardKey(row.cards);
    if (key === null) continue;

    const current = byCard.get(key) ?? { ...ZERO_AVAILABILITY };
    const committed = row.locations?.type === COMMITTED_LOCATION_TYPE;

    current.total += row.quantity;
    if (committed) current.inDecks += row.quantity;
    else current.available += row.quantity;

    byCard.set(key, current);
  }

  return byCard;
}

/** Availability for one row's card, or zeroes if it is not in the map. */
export function availabilityFor(
  map: Map<string, Availability>,
  card: { oracle_id: string | null; name: string } | null,
): Availability {
  const key = cardKey(card);
  if (key === null) return ZERO_AVAILABILITY;
  return map.get(key) ?? ZERO_AVAILABILITY;
}

/** True when a row's copy is itself sitting in a deck. */
export const isCommitted = (row: Pick<CardInstanceWithCard, "locations">): boolean =>
  row.locations?.type === COMMITTED_LOCATION_TYPE;

/**
 * How many copies of a stack can be taken.
 *
 * A stack already in a deck offers nothing: moving it would be a transfer
 * between decks, which is a different operation with different consequences and
 * should be asked for explicitly rather than falling out of "add from
 * collection".
 */
export function takeableFrom(row: Pick<CardInstanceWithCard, "quantity" | "locations">): number {
  return isCommitted(row) ? 0 : row.quantity;
}

/**
 * What splitting a stack leaves behind.
 *
 * Taking every copy moves the row itself, which keeps its id, notes and
 * acquisition date intact. Taking some of them has to leave the remainder where
 * it was and put a new row in the deck.
 */
export type SplitPlan =
  | { action: "moveWhole"; quantity: number }
  | { action: "split"; take: number; leave: number };

export function planSplit(available: number, wanted: number): SplitPlan | { error: string } {
  if (!Number.isInteger(wanted) || wanted < 1) {
    return { error: "Choose at least one copy." };
  }
  if (wanted > available) {
    return {
      error:
        available === 0
          ? "No copies of that stack are available."
          : `Only ${available} ${available === 1 ? "copy is" : "copies are"} available.`,
    };
  }
  if (wanted === available) return { action: "moveWhole", quantity: wanted };
  return { action: "split", take: wanted, leave: available - wanted };
}
