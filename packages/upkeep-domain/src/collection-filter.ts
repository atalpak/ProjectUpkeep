/**
 * Filtering a person's own collection, in memory.
 *
 * The mobile Collection screen loads the whole collection once and filters it
 * here as you type, rather than asking the database per keystroke: a
 * two-letter `ilike` over the card table cannot use its trigram index and
 * stalled in practice. A collection is hundreds to a few thousand rows, which
 * is nothing to filter locally.
 *
 * Structural types only, so it needs no import of the app's own row type.
 */

import { colorsOf, matchesColors, type Color } from "./card-search";

export type CollectionFilter = {
  /** Every word must appear in the card name. */
  name: string;
  colors: ("W" | "U" | "B" | "R" | "G")[];
  /** Colourless cards only. Exclusive with `colors`. */
  colorless: boolean;
  /** `all`: has every chosen colour. `any`: has at least one. */
  colorMode: "all" | "any";
  rarity: string;
  finish: string;
  condition: string;
  /** '' = anywhere, 'unsorted', or a location id. */
  location: string;
  type: string;
  set: string;
};

export const EMPTY_COLLECTION_FILTER: CollectionFilter = {
  name: "", colors: [], colorless: false, colorMode: "all", rarity: "", finish: "", condition: "", location: "", type: "", set: "",
};

/** How many facets beyond the name text are set, for a "Filters (3)" badge. */
export function collectionFacetCount(f: CollectionFilter): number {
  return (f.colors.length || f.colorless ? 1 : 0) + [f.rarity, f.finish, f.condition, f.location, f.type.trim(), f.set.trim()].filter(Boolean).length;
}

export type FilterableEntry = {
  card_name: string;
  card_type_line: string | null;
  card_colors: string[] | null;
  card_set_code: string;
  card_rarity: string;
  finish: string;
  condition: string;
  location_id: string | null;
};

/** Case- and accent-insensitive, so "eclair" finds "Éclair". */
const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function matchesCollectionFilter(e: FilterableEntry, f: CollectionFilter): boolean {
  if (f.rarity && e.card_rarity !== f.rarity) return false;
  if (f.finish && e.finish !== f.finish) return false;
  if (f.condition && e.condition !== f.condition) return false;
  if (f.location === "unsorted" ? e.location_id !== null : f.location !== "" && e.location_id !== f.location) return false;
  if (f.set.trim() && e.card_set_code.toLowerCase() !== f.set.trim().toLowerCase()) return false;
  if (f.type.trim() && !norm(e.card_type_line ?? "").includes(norm(f.type.trim()))) return false;

  if (f.colorless) {
    if (colorsOf(e.card_colors).some((c) => c !== "C")) return false;
  } else if (f.colors.length && !matchesColors(colorsOf(e.card_colors), f.colors as Color[], f.colorMode)) {
    return false;
  }

  const words = norm(f.name).split(/\s+/).filter(Boolean);
  if (words.length) {
    const name = norm(e.card_name);
    if (!words.every((w) => name.includes(w))) return false;
  }
  return true;
}

/** Keeps the input order (the screen loads it sorted by name). */
export function filterCollection<T extends FilterableEntry>(entries: T[], f: CollectionFilter): T[] {
  return entries.filter((e) => matchesCollectionFilter(e, f));
}
