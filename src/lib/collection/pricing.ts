/**
 * What a card is worth, and what that number is allowed to claim.
 *
 * Prices come from Scryfall's daily bulk export; the USD figures are
 * TCGplayer-derived. They are a snapshot of one market, not a quote, and this
 * module is written so the UI can never accidentally present them as more than
 * that:
 *
 *   - A missing price is null, never zero. A card with no recent sale is
 *     unpriced, and a collection total that quietly counted it as free would be
 *     wrong in the direction people care about.
 *   - Totals report how many rows they could not price, so "£412 across 380 of
 *     420 cards" is sayable rather than a bare number that implies completeness.
 *   - The finish decides the price. A foil is not worth its non-foil price, and
 *     pretending otherwise is the most common way these numbers go wrong.
 */

import type { Card, CardInstanceWithCard, Finish } from "@/lib/types";

/** Cards we can price, without demanding a full Card everywhere. */
export type PriceableCard = Pick<
  Card,
  "price_usd" | "price_usd_foil" | "price_usd_etched"
>;

/**
 * The price for one copy, given its finish.
 *
 * Deliberately does NOT fall back from foil to non-foil. A foil with no listed
 * foil price is unpriced; substituting the non-foil figure would understate a
 * foil, often by a lot, while looking like a real answer.
 */
export function priceFor(
  card: PriceableCard | null | undefined,
  finish: Finish | string,
): number | null {
  if (!card) return null;

  switch (finish) {
    case "foil":
      return card.price_usd_foil ?? null;
    case "etched":
      return card.price_usd_etched ?? null;
    // Glossy is rare enough that Scryfall does not price it separately; it is a
    // non-foil variant, so the non-foil price is the honest answer.
    case "glossy":
    case "nonfoil":
    default:
      return card.price_usd ?? null;
  }
}

/**
 * The price to *show* for one copy of a given finish.
 *
 * Unlike `priceFor`, this falls back to the non-foil price for a foil or etched
 * copy that has no finish-specific listing. Scryfall often prices only one
 * finish — Secret Lair and many Universes Beyond printings especially — and a
 * card that plainly has a value showing no price at all reads as a bug. The
 * fallback is flagged `approximate` so the UI can mark it (a `~`); anything
 * that must not be overstated, like the collection-value total, keeps using
 * `priceFor`.
 */
export function displayPrice(
  card: PriceableCard | null | undefined,
  finish: Finish | string,
): { value: number | null; approximate: boolean } {
  const exact = priceFor(card, finish);
  if (exact !== null) return { value: exact, approximate: false };

  if ((finish === "foil" || finish === "etched") && card?.price_usd != null) {
    return { value: card.price_usd, approximate: true };
  }
  return { value: null, approximate: false };
}

/** What one row of a collection is worth: price × how many. */
export function rowValue(row: {
  cards: PriceableCard | null;
  finish: string;
  quantity: number;
}): number | null {
  const unit = priceFor(row.cards, row.finish);
  return unit === null ? null : unit * row.quantity;
}

export type ValueSummary = {
  /** Total of everything that could be priced. */
  total: number;
  /** Rows that carried a price. */
  pricedRows: number;
  /** Rows with no price for their finish. */
  unpricedRows: number;
  /** Physical cards behind `total`. */
  pricedCards: number;
  /** The single most valuable row, for "your best card" style callouts. */
  mostValuable: { name: string; value: number } | null;
};

export const ZERO_VALUE: ValueSummary = {
  total: 0,
  pricedRows: 0,
  unpricedRows: 0,
  pricedCards: 0,
  mostValuable: null,
};

export function summariseValue(rows: CardInstanceWithCard[]): ValueSummary {
  let total = 0;
  let pricedRows = 0;
  let unpricedRows = 0;
  let pricedCards = 0;
  let mostValuable: ValueSummary["mostValuable"] = null;

  for (const row of rows) {
    const value = rowValue(row);

    if (value === null) {
      unpricedRows += 1;
      continue;
    }

    total += value;
    pricedRows += 1;
    pricedCards += row.quantity;

    if (!mostValuable || value > mostValuable.value) {
      mostValuable = { name: row.cards?.name ?? "Unknown card", value };
    }
  }

  // Rounded once, at the end. Rounding each row and summing would drift by a
  // cent per row across a large collection.
  return {
    total: Math.round(total * 100) / 100,
    pricedRows,
    unpricedRows,
    pricedCards,
    mostValuable: mostValuable
      ? { ...mostValuable, value: Math.round(mostValuable.value * 100) / 100 }
      : null,
  };
}

/** US dollars, because that is what the source quotes. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    // Whole dollars once a number is large enough that cents are noise.
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/** Where the price is remembered as shown or hidden. Per browser. */
export const PRICES_STORAGE_KEY = "project-upkeep-show-prices";
