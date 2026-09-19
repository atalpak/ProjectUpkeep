/**
 * Ordering a person's own collection, in memory.
 *
 * Sits beside collection-filter for the same reason: the Collection screen
 * holds the whole collection and re-derives the visible list locally, so a new
 * sort is a re-order, not a new query. The load itself stays name-ordered (it
 * needs a stable paging order); this is applied on top.
 *
 * Every comparison falls back to name and then id, so equal keys never shuffle
 * between renders and a re-sort of an already-sorted list is a no-op.
 * Structural types only, like collection-filter.
 */

export const COLLECTION_SORTS = ["name", "mana", "rarity", "price", "added", "set"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export const DEFAULT_COLLECTION_SORT: CollectionSort = "name";

export const COLLECTION_SORT_LABELS: Record<CollectionSort, string> = {
  name: "Name",
  mana: "Mana value",
  rarity: "Rarity",
  price: "Price, high to low",
  added: "Recently added",
  set: "Set",
};

/** Stored data is untrusted after an app update. */
export function readCollectionSort(v: unknown): CollectionSort {
  return (COLLECTION_SORTS as readonly unknown[]).includes(v) ? (v as CollectionSort) : DEFAULT_COLLECTION_SORT;
}

type PriceCell = number | string | null | undefined;

export type PricedEntry = {
  finish: string;
  card_price_usd?: PriceCell;
  card_price_usd_foil?: PriceCell;
  card_price_usd_etched?: PriceCell;
};

export type SortableEntry = PricedEntry & {
  id: string;
  card_name: string;
  card_set_code: string;
  card_collector_number?: string;
  card_rarity: string;
  card_cmc?: number | string | null;
  created_at?: string | null;
};

const num = (v: PriceCell): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The USD estimate for one copy, respecting its finish. Foil and etched fall
 * back to the plain price when Scryfall has no separate one (an estimate, the
 * same fallback as `displayPrice` in src/lib/collection/pricing.ts and the
 * `display_price` column of the collection_entries view). Null = unpriced.
 */
export function entryPrice(e: PricedEntry): number | null {
  const plain = num(e.card_price_usd);
  if (e.finish === "foil") return num(e.card_price_usd_foil) ?? plain;
  if (e.finish === "etched") return num(e.card_price_usd_etched) ?? plain;
  return plain;
}

const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

/** Missing values sort last in both directions, so unpriced cards never lead a price sort. */
function byNumberDesc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
function byNumberAsc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Returns a new array; the input is not mutated. */
export function sortCollection<T extends SortableEntry>(entries: T[], sort: CollectionSort): T[] {
  const primary = (a: T, b: T): number => {
    switch (sort) {
      case "name":
        return 0;
      case "mana":
        return byNumberAsc(num(a.card_cmc), num(b.card_cmc));
      case "rarity":
        // Rarest first: a collection is browsed for its best cards.
        return (RARITY_RANK[b.card_rarity] ?? -1) - (RARITY_RANK[a.card_rarity] ?? -1);
      case "price":
        return byNumberDesc(entryPrice(a), entryPrice(b));
      case "added":
        // ISO timestamps compare correctly as strings; newest first.
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      case "set":
        return byText(a.card_set_code, b.card_set_code) || byText(a.card_collector_number ?? "", b.card_collector_number ?? "");
    }
  };
  return [...entries].sort((a, b) => primary(a, b) || byText(a.card_name, b.card_name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
