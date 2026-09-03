/**
 * The collection filter model.
 *
 * One pure module holding what a filter *is*, how it survives a URL round trip,
 * and whether a given row matches. Kept free of database and React so the
 * matching rules — the part with all the edge cases — can be tested directly.
 *
 * Filtering runs in application code over the user's own rows rather than in
 * Postgres. That is a deliberate trade, for the same reason the name filter
 * already worked this way: a collection is thousands of rows, not millions, and
 * splitting the rules across a PostgREST query and a JavaScript pass would mean
 * two places to get colour-matching and mana costs subtly wrong. `MAX_ROWS`
 * below is the point at which that trade stops being safe.
 *
 * Not supported, deliberately:
 *   - price. The charter excludes pricing outright (docs/CHARTER.md §2), and no
 *     price data is stored or synced.
 *   - alterations and playtest cards. Scryfall exposes both; we do not sync
 *     them, so a filter would silently match nothing.
 */

import {
  CONDITIONS,
  FINISHES,
  type CardInstanceWithCard,
  type Condition,
  type Finish,
} from "@/lib/types";

/** Beyond this, in-memory filtering stops being the right approach. */
export const MAX_ROWS = 20_000;

/** Magic's five colours plus colourless, as Scryfall spells them. */
export const COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_LABELS: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

/** How a set of selected colours should be compared against a card's. */
export const COLOR_MODES = ["all", "any", "exactly", "atMost"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  all: "Must have all selected",
  any: "Must have any selected",
  exactly: "Must be exactly these",
  atMost: "Must have at most these",
};

export const NUMERIC_OPS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;
export type NumericOp = (typeof NUMERIC_OPS)[number];

export const NUMERIC_OP_LABELS: Record<NumericOp, string> = {
  eq: "Equals",
  ne: "Not equal to",
  gt: "Greater than",
  gte: "Greater or equal",
  lt: "Less than",
  lte: "Less or equal",
};

export type NumericFilter = { op: NumericOp; value: number } | null;

export const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"] as const;

/** Special value for the location filter, since null already means "unsorted". */
export const UNSORTED = "unsorted";

export type CollectionFilter = {
  /** Substring match on the card name. */
  name: string;
  /** Set code. */
  set: string;
  /** Substring match on rules text; wrap in quotes for an exact phrase. */
  oracle: string;
  /** Substring match on the type line. */
  type: string;
  colors: Color[];
  colorMode: ColorMode;
  colorIdentity: Color[];
  manaValue: NumericFilter;
  /** Symbols that must all appear in the printed cost, e.g. "{2}{G}". */
  manaCost: string;
  power: NumericFilter;
  toughness: NumericFilter;
  loyalty: NumericFilter;
  rarity: string;
  condition: Condition | "";
  finish: Finish | "";
  language: string;
  /** A location id, UNSORTED, or "" for everywhere. */
  location: string;
};

export const EMPTY_FILTER: CollectionFilter = {
  name: "",
  set: "",
  oracle: "",
  type: "",
  colors: [],
  colorMode: "all",
  colorIdentity: [],
  manaValue: null,
  manaCost: "",
  power: null,
  toughness: null,
  loyalty: null,
  rarity: "",
  condition: "",
  finish: "",
  language: "",
  location: "",
};

// ---------------------------------------------------------------------------
// URL round trip
// ---------------------------------------------------------------------------

const asColors = (raw: string | null): Color[] =>
  (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is Color => (COLORS as readonly string[]).includes(c));

function asNumeric(raw: string | null): NumericFilter {
  if (!raw) return null;
  // Stored as "op:value" so one parameter carries the whole comparison.
  const [op, value] = raw.split(":");
  const n = Number.parseFloat(value ?? "");
  if (!(NUMERIC_OPS as readonly string[]).includes(op) || !Number.isFinite(n)) return null;
  return { op: op as NumericOp, value: n };
}

const oneOf = <T extends string>(raw: string | null, allowed: readonly T[]): T | "" =>
  raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : "";

/**
 * Reads a filter out of a URL.
 *
 * Filters live in the query string so a filtered view can be linked, shared and
 * survive a refresh — the same reason the original page used a GET form.
 */
export function filterFromParams(
  params: Record<string, string | string[] | undefined>,
): CollectionFilter {
  const get = (key: string): string | null => {
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const mode = get("colorMode");

  return {
    name: get("q") ?? "",
    set: get("set") ?? "",
    oracle: get("oracle") ?? "",
    type: get("type") ?? "",
    colors: asColors(get("colors")),
    colorMode: (COLOR_MODES as readonly string[]).includes(mode ?? "")
      ? (mode as ColorMode)
      : "all",
    colorIdentity: asColors(get("ci")),
    manaValue: asNumeric(get("mv")),
    manaCost: get("cost") ?? "",
    power: asNumeric(get("pow")),
    toughness: asNumeric(get("tou")),
    loyalty: asNumeric(get("loy")),
    rarity: oneOf(get("rarity"), RARITIES),
    condition: oneOf(get("condition"), CONDITIONS),
    finish: oneOf(get("finish"), FINISHES),
    language: get("language") ?? "",
    location: get("location") ?? "",
  };
}

/** The inverse of `filterFromParams`. Omits anything left at its default. */
export function filterToParams(filter: CollectionFilter): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value.trim() !== "") params.set(key, value.trim());
  };

  set("q", filter.name);
  set("set", filter.set);
  set("oracle", filter.oracle);
  set("type", filter.type);
  if (filter.colors.length > 0) {
    params.set("colors", filter.colors.join(","));
    // Only meaningful alongside a colour selection.
    if (filter.colorMode !== "all") params.set("colorMode", filter.colorMode);
  }
  if (filter.colorIdentity.length > 0) params.set("ci", filter.colorIdentity.join(","));
  if (filter.manaValue) params.set("mv", `${filter.manaValue.op}:${filter.manaValue.value}`);
  set("cost", filter.manaCost);
  if (filter.power) params.set("pow", `${filter.power.op}:${filter.power.value}`);
  if (filter.toughness) params.set("tou", `${filter.toughness.op}:${filter.toughness.value}`);
  if (filter.loyalty) params.set("loy", `${filter.loyalty.op}:${filter.loyalty.value}`);
  set("rarity", filter.rarity);
  set("condition", filter.condition);
  set("finish", filter.finish);
  set("language", filter.language);
  set("location", filter.location);

  return params;
}

/** How many criteria are active, for the "Filters (3)" badge. */
export function activeFilterCount(filter: CollectionFilter): number {
  let count = 0;
  for (const [key, value] of Object.entries(filter)) {
    // Not a criterion of its own; it only qualifies `colors`.
    if (key === "colorMode") continue;
    if (Array.isArray(value)) count += value.length > 0 ? 1 : 0;
    else if (value === null) continue;
    else if (typeof value === "object") count += 1;
    else if (String(value).trim() !== "") count += 1;
  }
  return count;
}

export const isFilterActive = (filter: CollectionFilter): boolean =>
  activeFilterCount(filter) > 0;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();

/**
 * Text match with quoted-phrase support, matching the hint on Moxfield's own
 * oracle box: bare words all have to appear somewhere, quotes mean the exact
 * phrase.
 */
function matchesText(haystack: string | null | undefined, needle: string): boolean {
  const text = norm(haystack);
  const query = needle.trim().toLowerCase();
  if (query === "") return true;

  const quoted = query.match(/^"(.*)"$/);
  if (quoted) return text.includes(quoted[1]);

  return query.split(/\s+/).every((word) => text.includes(word));
}

function matchesNumeric(actual: number | null | undefined, filter: NumericFilter): boolean {
  if (!filter) return true;
  if (actual === null || actual === undefined) return false;

  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "ne":
      return actual !== filter.value;
    case "gt":
      return actual > filter.value;
    case "gte":
      return actual >= filter.value;
    case "lt":
      return actual < filter.value;
    case "lte":
      return actual <= filter.value;
  }
}

/**
 * Reads a printed power/toughness as a number.
 *
 * Real cards print "*", "1+*" and "∞" in these boxes. Those are not numbers and
 * are reported as such, so a "power ≥ 3" filter excludes them rather than
 * treating them as zero.
 */
export function statToNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (text === "") return null;

  // The whole string has to be a number. parseFloat alone is too lenient: it
  // reads "1+*" as 1, which would quietly file Tarmogoyf as a 1/2 and let it
  // satisfy "power equals 1".
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number.parseFloat(text);
}

/** Cards with no colour at all count as colourless for filtering. */
function colorsOf(raw: string[] | null | undefined): Color[] {
  const colors = (raw ?? []).filter((c): c is Color => (COLORS as readonly string[]).includes(c));
  return colors.length > 0 ? colors : ["C"];
}

function matchesColors(cardColors: Color[], selected: Color[], mode: ColorMode): boolean {
  if (selected.length === 0) return true;

  const card = new Set(cardColors);
  const want = new Set(selected);

  switch (mode) {
    case "all":
      return [...want].every((c) => card.has(c));
    case "any":
      return [...want].some((c) => card.has(c));
    case "exactly":
      return card.size === want.size && [...want].every((c) => card.has(c));
    case "atMost":
      return [...card].every((c) => want.has(c));
  }
}

/**
 * Does the printed cost contain every symbol the filter asked for?
 *
 * "{2}{G}" is read as the symbols {2} and {G}, and both must appear — so it
 * matches {2}{G}{G} as well. Bare input like "2G" is accepted too, since that
 * is how people type it.
 */
function matchesManaCost(cost: string | null | undefined, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;

  const printed = norm(cost);
  if (printed === "") return false;

  const symbols = trimmed.toUpperCase().match(/\{[^}]+\}/g) ??
    // No braces: treat each character as its own symbol.
    trimmed.toUpperCase().replace(/\s+/g, "").split("").map((c) => `{${c}}`);

  // Count-aware: asking for {G}{G} should not be satisfied by a single {G}.
  const remaining = printed;
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    const key = symbol.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [symbol, needed] of counts) {
    const found = remaining.split(symbol).length - 1;
    if (found < needed) return false;
  }
  return true;
}

/** Does one collection row satisfy every active criterion? */
export function matchesFilter(row: CardInstanceWithCard, filter: CollectionFilter): boolean {
  const card = row.cards;

  // Instance-level criteria first: they are the cheapest and the most selective.
  if (filter.condition && row.condition !== filter.condition) return false;
  if (filter.finish && row.finish !== filter.finish) return false;
  if (filter.language && row.language !== filter.language) return false;

  if (filter.location === UNSORTED) {
    if (row.location_id !== null) return false;
  } else if (filter.location && row.location_id !== filter.location) {
    return false;
  }

  // A row whose printing is missing cannot satisfy any card-level criterion.
  // card_id is NOT NULL with a foreign key, so this should be unreachable — but
  // failing closed here is better than throwing on a null.
  if (!card) {
    return (
      !filter.name &&
      !filter.set &&
      !filter.oracle &&
      !filter.type &&
      filter.colors.length === 0 &&
      filter.colorIdentity.length === 0 &&
      !filter.manaValue &&
      !filter.manaCost &&
      !filter.power &&
      !filter.toughness &&
      !filter.loyalty &&
      !filter.rarity
    );
  }

  if (filter.name && !matchesText(card.name, filter.name)) return false;
  if (filter.set && norm(card.set_code) !== norm(filter.set)) return false;
  if (filter.rarity && norm(card.rarity) !== norm(filter.rarity)) return false;
  if (filter.type && !matchesText(card.type_line, filter.type)) return false;

  if (filter.oracle) {
    // Search the back face too: on a transform card half the rules text lives
    // there, and someone searching for it means the card, not the face.
    const faces = (card.card_faces ?? []).map((f) => f.oracle_text ?? "").join("\n");
    const combined = [card.oracle_text ?? "", faces].join("\n");
    if (!matchesText(combined, filter.oracle)) return false;
  }

  if (!matchesColors(colorsOf(card.colors), filter.colors, filter.colorMode)) return false;
  // Identity is a containment question, never an "exactly" one, so it always
  // uses "all" — a Golgari deck slot wants cards whose identity includes B and G.
  if (!matchesColors(colorsOf(card.color_identity), filter.colorIdentity, "all")) return false;

  if (!matchesNumeric(card.cmc, filter.manaValue)) return false;
  if (!matchesManaCost(card.mana_cost, filter.manaCost)) return false;

  if (!matchesNumeric(statToNumber(card.power), filter.power)) return false;
  if (!matchesNumeric(statToNumber(card.toughness), filter.toughness)) return false;
  if (!matchesNumeric(statToNumber(card.loyalty), filter.loyalty)) return false;

  return true;
}

export const applyFilter = (
  rows: CardInstanceWithCard[],
  filter: CollectionFilter,
): CardInstanceWithCard[] => rows.filter((row) => matchesFilter(row, filter));
