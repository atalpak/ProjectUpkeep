/**
 * Advanced card search — the filter model, a reader for a small slice of
 * literal Scryfall syntax, and the matching PostgREST cannot express.
 *
 * Pure and framework-free so the mobile app can share it. The web app has its
 * own older copy of the same rules (`src/lib/cards/search-query.ts` plus
 * `src/lib/collection/filters.ts`); they are meant to agree, and folding the
 * web side onto this module is a follow-up, not something this file assumes.
 *
 * The syntax slice: `c:`/`color:` (`:` all, `=` exactly, `<=` at most),
 * `cmc:`/`mv:` and `loy:`/`loyalty:` with every numeric comparator, `t:`,
 * `o:`, `s:`, `r:`. Any other `key:value` clause is reported as unsupported
 * rather than silently read as a name word.
 */

export const COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_MODES = ["all", "any", "exactly", "atMost"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const NUMERIC_OPS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;
export type NumericOp = (typeof NUMERIC_OPS)[number];
export type NumericFilter = { op: NumericOp; value: number } | null;

export type AdvancedCardFilter = {
  /** Card-name words; also where unrecognised bare words from a raw query land. */
  name: string;
  colors: Color[];
  colorMode: ColorMode;
  cmc: NumericFilter;
  loyalty: NumericFilter;
  type: string;
  oracle: string;
  set: string;
  rarity: string;
};

export const EMPTY_ADVANCED_FILTER: AdvancedCardFilter = {
  name: "",
  colors: [],
  colorMode: "all",
  cmc: null,
  loyalty: null,
  type: "",
  oracle: "",
  set: "",
  rarity: "",
};

export function isAdvancedFilterActive(filter: AdvancedCardFilter): boolean {
  return (
    filter.name.trim() !== "" ||
    filter.colors.length > 0 ||
    filter.cmc !== null ||
    filter.loyalty !== null ||
    filter.type.trim() !== "" ||
    filter.oracle.trim() !== "" ||
    filter.set.trim() !== "" ||
    filter.rarity.trim() !== ""
  );
}

/** How many facets beyond the name are set — for a "Filters (3)" badge. */
export function advancedFacetCount(filter: AdvancedCardFilter): number {
  return (
    (filter.colors.length > 0 ? 1 : 0) +
    (filter.cmc ? 1 : 0) +
    (filter.loyalty ? 1 : 0) +
    (filter.type.trim() ? 1 : 0) +
    (filter.oracle.trim() ? 1 : 0) +
    (filter.set.trim() ? 1 : 0) +
    (filter.rarity.trim() ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// Literal Scryfall syntax
// ---------------------------------------------------------------------------

const NUMERIC_COMPARATORS: Array<[string, NumericOp]> = [
  [">=", "gte"],
  ["<=", "lte"],
  ["!=", "ne"],
  [">", "gt"],
  ["<", "lt"],
  ["=", "eq"],
  [":", "eq"],
];

/** Splits on whitespace, keeping `key:"quoted value"` (and a bare quoted
 *  phrase) together as one token. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /[^\s"]*"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query))) tokens.push(match[0]);
  return tokens;
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, "$1");

const COLOR_ALIASES: Record<string, Color> = {
  w: "W", white: "W",
  u: "U", blue: "U",
  b: "B", black: "B",
  r: "R", red: "R",
  g: "G", green: "G",
  c: "C", colorless: "C",
};

function parseColorToken(rest: string): { colors: Color[]; mode: ColorMode } | null {
  for (const [op, mode] of [["<=", "atMost"], ["=", "exactly"], [":", "all"]] as const) {
    if (!rest.startsWith(op)) continue;
    const raw = rest.slice(op.length).toLowerCase();
    // "red,blue" is two names; "wu" is two letters run together. A comma part
    // maps as a whole name first, and only falls back to per-letter shorthand.
    const colors = raw
      .split(",")
      .flatMap((part) => (COLOR_ALIASES[part] ? [COLOR_ALIASES[part]!] : part.split("").map((c) => COLOR_ALIASES[c])))
      .filter((c): c is Color => Boolean(c));
    if (colors.length === 0) return null;
    return { colors: [...new Set(colors)], mode };
  }
  return null;
}

export type ParsedScryfallQuery = {
  filter: AdvancedCardFilter;
  /** Operators recognised but not applied — surfaced so the caller can say so. */
  unsupported: string[];
};

/** True when the text uses any facet syntax, i.e. it is more than a plain name. */
export function looksLikeScryfallSyntax(raw: string): boolean {
  return tokenize(raw.trim()).some((t) => /^[a-z]+(:|=|!=|>=|<=|>|<)/i.test(t));
}

export function parseScryfallQuery(raw: string): ParsedScryfallQuery {
  const filter: AdvancedCardFilter = { ...EMPTY_ADVANCED_FILTER };
  const unsupported: string[] = [];
  const nameWords: string[] = [];

  for (const token of tokenize(raw.trim())) {
    const lower = token.toLowerCase();

    const colorMatch = lower.match(/^(?:c|color)(:|<=|=)(.+)$/);
    if (colorMatch) {
      const parsed = parseColorToken(colorMatch[1]! + colorMatch[2]!);
      if (parsed) {
        filter.colors = parsed.colors;
        filter.colorMode = parsed.mode;
        continue;
      }
    }

    const cmcMatch = lower.match(/^(?:cmc|mv)(:|=|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (cmcMatch) {
      const op = NUMERIC_COMPARATORS.find(([o]) => o === cmcMatch[1])?.[1] ?? "eq";
      filter.cmc = { op, value: Number.parseFloat(cmcMatch[2]!) };
      continue;
    }

    const loyaltyMatch = lower.match(/^(?:loy|loyalty)(:|=|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (loyaltyMatch) {
      const op = NUMERIC_COMPARATORS.find(([o]) => o === loyaltyMatch[1])?.[1] ?? "eq";
      filter.loyalty = { op, value: Number.parseFloat(loyaltyMatch[2]!) };
      continue;
    }

    const typeMatch = token.match(/^(?:t|type):(.+)$/i);
    if (typeMatch) { filter.type = unquote(typeMatch[1]!); continue; }

    const oracleMatch = token.match(/^(?:o|oracle):(.+)$/i);
    if (oracleMatch) { filter.oracle = unquote(oracleMatch[1]!); continue; }

    const setMatch = token.match(/^(?:s|set):(.+)$/i);
    if (setMatch) { filter.set = unquote(setMatch[1]!); continue; }

    const rarityMatch = token.match(/^(?:r|rarity):(.+)$/i);
    if (rarityMatch) { filter.rarity = unquote(rarityMatch[1]!); continue; }

    if (/^[a-z]+(:|=|!=|>=|<=|>|<)/i.test(token)) {
      unsupported.push(token);
      continue;
    }

    nameWords.push(unquote(token));
  }

  filter.name = nameWords.join(" ");
  return { filter, unsupported };
}

// ---------------------------------------------------------------------------
// Matching — the part PostgREST cannot express on its own
// ---------------------------------------------------------------------------

export function matchesNumeric(actual: number | null | undefined, filter: NumericFilter): boolean {
  if (!filter) return true;
  if (actual === null || actual === undefined) return false;
  switch (filter.op) {
    case "eq": return actual === filter.value;
    case "ne": return actual !== filter.value;
    case "gt": return actual > filter.value;
    case "gte": return actual >= filter.value;
    case "lt": return actual < filter.value;
    case "lte": return actual <= filter.value;
  }
}

/** Reads a printed stat as a number. "*", "1+*" and "∞" are not numbers and
 *  come back null, so a "loyalty ≥ 3" filter excludes them rather than
 *  reading them as zero (parseFloat alone would read "1+*" as 1). */
export function statToNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number.parseFloat(text);
}

/** Cards with no colour count as colourless for filtering. */
export function colorsOf(raw: string[] | null | undefined): Color[] {
  const colors = (raw ?? []).filter((c): c is Color => (COLORS as readonly string[]).includes(c));
  return colors.length > 0 ? colors : ["C"];
}

export function matchesColors(cardColors: Color[], selected: Color[], mode: ColorMode): boolean {
  if (selected.length === 0) return true;
  const card = new Set(cardColors);
  const want = new Set(selected);
  switch (mode) {
    case "all": return [...want].every((c) => card.has(c));
    case "any": return [...want].some((c) => card.has(c));
    case "exactly": return card.size === want.size && [...want].every((c) => card.has(c));
    case "atMost": return [...card].every((c) => want.has(c));
  }
}

/** The least a printing needs for `matchesAdvancedCard` to judge it. */
export type AdvancedMatchableCard = { colors: string[] | null; loyalty: string | null };

/** Finishes what SQL could not: exact/at-most colour sets and text loyalty. */
export function matchesAdvancedCard(card: AdvancedMatchableCard, filter: AdvancedCardFilter): boolean {
  return (
    matchesColors(colorsOf(card.colors), filter.colors, filter.colorMode) &&
    matchesNumeric(statToNumber(card.loyalty), filter.loyalty)
  );
}
