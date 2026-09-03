/**
 * Column definitions for the collection table.
 *
 * Separate from the table component so the set of columns, their default
 * visibility and how each one sorts are described in one readable place rather
 * than spread through JSX.
 */

import type { CardInstanceWithCard } from "@/lib/types";
import { statToNumber } from "@/lib/collection/filters";
import { availabilityFor, type Availability } from "@/lib/collection/availability";
import { priceFor } from "@/lib/collection/pricing";

/**
 * What a column may need beyond the row itself.
 *
 * Availability is counted across every printing of a card, so it cannot be read
 * off a single row — the table passes the map in.
 */
export type SortContext = { availability: Map<string, Availability> };

export type ColumnId =
  | "quantity"
  | "name"
  | "set"
  | "collector"
  | "rarity"
  | "manaCost"
  | "manaValue"
  | "type"
  | "colors"
  | "power"
  | "condition"
  | "language"
  | "location"
  | "artist"
  | "notes"
  | "available"
  | "price";

export type ColumnDef = {
  id: ColumnId;
  label: string;
  /** Shown when the user has not chosen their own columns. */
  default: boolean;
  /** Right-aligned and tabular, for anything numeric. */
  numeric?: boolean;
  /**
   * Sort key. Returning a string sorts alphabetically, a number numerically,
   * and null always sorts last regardless of direction — a card with no power
   * is not "less than" a 1/1, it is simply not in the running.
   */
  sortBy: (row: CardInstanceWithCard, context: SortContext) => string | number | null;
};

export const COLUMNS: ColumnDef[] = [
  {
    id: "quantity",
    label: "Qty",
    default: true,
    numeric: true,
    sortBy: (r) => r.quantity,
  },
  {
    id: "name",
    label: "Name",
    default: true,
    sortBy: (r) => r.cards?.name?.toLowerCase() ?? "",
  },
  {
    id: "set",
    label: "Set",
    default: true,
    sortBy: (r) => r.cards?.set_name?.toLowerCase() ?? r.cards?.set_code ?? "",
  },
  {
    id: "collector",
    label: "Number",
    default: false,
    numeric: true,
    // Collector numbers are text ("123a", "★"), so sort them the way a person
    // reads them rather than by raw code point.
    sortBy: (r) => r.cards?.collector_number ?? "",
  },
  { id: "rarity", label: "Rarity", default: false, sortBy: (r) => r.cards?.rarity ?? "" },
  { id: "manaCost", label: "Cost", default: false, sortBy: (r) => r.cards?.mana_cost ?? "" },
  {
    id: "manaValue",
    label: "MV",
    default: false,
    numeric: true,
    sortBy: (r) => r.cards?.cmc ?? null,
  },
  { id: "type", label: "Type", default: false, sortBy: (r) => r.cards?.type_line ?? "" },
  {
    id: "colors",
    label: "Colors",
    default: false,
    sortBy: (r) => (r.cards?.colors ?? []).join(""),
  },
  {
    id: "power",
    label: "P/T",
    default: false,
    numeric: true,
    sortBy: (r) => statToNumber(r.cards?.power),
  },
  { id: "condition", label: "Condition", default: false, sortBy: (r) => r.condition },
  // No Finish column: a foil is marked beside the card name instead. See
  // src/components/FoilMark.tsx.
  { id: "language", label: "Language", default: false, sortBy: (r) => r.language },
  {
    id: "location",
    label: "Location",
    default: false,
    // Unsorted sorts last rather than first: it is the absence of a location.
    sortBy: (r) => r.locations?.name?.toLowerCase() ?? "￿",
  },
  { id: "artist", label: "Artist", default: false, sortBy: (r) => r.cards?.artist ?? "" },
  { id: "notes", label: "Notes", default: false, sortBy: (r) => r.notes ?? "" },
  {
    id: "price",
    label: "Price",
    // On by default. What a collection is worth is one of the first things
    // anyone opens it to see, and this column is now the only switch for it —
    // the separate "$ Prices" toggle is gone, so turning the column off in the
    // Columns menu is how someone who does not want prices hides them.
    default: true,
    numeric: true,
    sortBy: (r) => priceFor(r.cards, r.finish),
  },
  {
    id: "available",
    label: "Available",
    // On by default: knowing whether a copy is free to build with is the whole
    // point of tracking where cards are, and it is the question this product
    // exists to answer.
    default: true,
    numeric: true,
    // Sorts by the number actually rendered, not by this row's quantity.
    sortBy: (r, { availability }) => availabilityFor(availability, r.cards).available,
  },
];

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

export const DEFAULT_COLUMNS: ColumnId[] = COLUMNS.filter((c) => c.default).map((c) => c.id);

/** Where the column choice is remembered. Per browser, not per account. */
export const COLUMNS_STORAGE_KEY = "mtgmanager-collection-columns";

export type SortState = { column: ColumnId; direction: "asc" | "desc" };

/**
 * Sorts rows by one column.
 *
 * Nulls are pinned to the end in both directions. Flipping the direction is
 * meant to reverse the ranking of things that *have* a value, not to promote
 * the ones that do not.
 */
export function sortRows(
  rows: CardInstanceWithCard[],
  sort: SortState | null,
  context: SortContext = { availability: new Map() },
): CardInstanceWithCard[] {
  if (!sort) return rows;

  const column = COLUMN_BY_ID.get(sort.column);
  if (!column) return rows;

  const factor = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = column.sortBy(a, context);
    const bv = column.sortBy(b, context);

    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;

    return (
      String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) *
      factor
    );
  });
}

// ---------------------------------------------------------------------------
// Persisted column choice
// ---------------------------------------------------------------------------

/**
 * The column choice, treated as an external store rather than React state.
 *
 * localStorage does not exist on the server, so the choice cannot be read
 * during the first render without the client disagreeing with the HTML it is
 * hydrating. Reading it in an effect and calling setState is the usual answer
 * and the one React now warns about. Subscribing to it instead is what
 * useSyncExternalStore is for: the server snapshot is null, the first client
 * snapshot is whatever is stored, and React reconciles the difference itself.
 */
const listeners = new Set<() => void>();

export function subscribeToColumns(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the choice should be reflected here too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Holds the choice when localStorage refuses the write.
 *
 * Without this the snapshot would keep reporting the stored value, so toggling
 * a column in a browser with site data blocked would appear to do nothing.
 * Null while writes are landing, so a change made in another tab still wins.
 */
let unsavedValue: string | null = null;

export function readStoredColumns(): string | null {
  try {
    return unsavedValue ?? localStorage.getItem(COLUMNS_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage.
    return unsavedValue;
  }
}

/** Server render has no storage; the defaults stand in. */
export const readStoredColumnsOnServer = (): string | null => null;

export function writeStoredColumns(columns: ColumnId[]): void {
  const serialised = JSON.stringify(columns);
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, serialised);
    unsavedValue = null;
  } catch {
    // Storage blocked: keep it in memory so the choice still applies for the
    // rest of this page view, even though it will not outlive it.
    unsavedValue = serialised;
  }
  for (const listener of listeners) listener();
}

/** Parses a stored value, falling back to the defaults if it is unusable. */
export function parseStoredColumns(raw: string | null): ColumnId[] {
  if (!raw) return DEFAULT_COLUMNS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const valid = parsed.filter((id): id is ColumnId => COLUMN_BY_ID.has(id as ColumnId));
    return valid.length > 0 ? valid : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}
