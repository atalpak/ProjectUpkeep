/**
 * Advanced card search — the structured filter model, its URL round trip, and
 * a best-effort reader for literal Scryfall syntax.
 *
 * Pure and standalone, same shape as `collection/filters.ts` and for the same
 * reason: the parsing rules are the fiddly part, and this is what lets them be
 * tested without a database or a component tree.
 *
 * Scryfall's syntax (https://scryfall.com/docs/syntax) is large; this reads a
 * deliberately small slice of it — the facets the structured panel below also
 * exposes. `parseScryfallQuery` exists to let someone type the same thing as
 * literal syntax, not to replace it:
 *
 *   - `c:` / `color:`, with `:`/`=`/`<=` (no `>=`, `<`, `>` — Scryfall's colour
 *     comparisons past "contains" / "exactly" / "at most" are rare in practice)
 *   - `cmc:` / `mv:`, with every numeric comparator
 *   - `t:` / `type:` — substring against the type line
 *   - `o:` / `oracle:` — substring against the oracle text
 *   - `s:` / `set:` — exact set code
 *   - `r:` / `rarity:` — exact rarity
 *
 * Anything else recognisable as a Scryfall operator (`is:`, `f:`, `game:`,
 * numeric comparisons on power/toughness, and so on) is reported back as
 * unsupported rather than silently dropped or misread as a name word — a
 * search that quietly ignores half of what was typed is worse than one that
 * says so.
 */

import {
  COLORS,
  COLOR_MODES,
  NUMERIC_OPS,
  colorsOf,
  matchesColors,
  type Color,
  type ColorMode,
  type NumericFilter,
  type NumericOp,
} from "@/lib/collection/filters";

export type AdvancedCardFilter = {
  /** Card-name substring; also where unrecognised bare words from a raw query land. */
  name: string;
  colors: Color[];
  colorMode: ColorMode;
  cmc: NumericFilter;
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
    filter.type.trim() !== "" ||
    filter.oracle.trim() !== "" ||
    filter.set.trim() !== "" ||
    filter.rarity.trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// URL round trip — mirrors filterToParams/filterFromParams in filters.ts
// ---------------------------------------------------------------------------

export function advancedFilterToParams(filter: AdvancedCardFilter): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value.trim() !== "") params.set(key, value.trim());
  };

  set("q", filter.name);
  if (filter.colors.length > 0) {
    params.set("colors", filter.colors.join(","));
    if (filter.colorMode !== "all") params.set("colorMode", filter.colorMode);
  }
  if (filter.cmc) params.set("cmc", `${filter.cmc.op}:${filter.cmc.value}`);
  set("type", filter.type);
  set("oracle", filter.oracle);
  set("set", filter.set);
  set("rarity", filter.rarity);

  return params;
}

const asColors = (raw: string | null): Color[] =>
  (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is Color => (COLORS as readonly string[]).includes(c));

function asNumeric(raw: string | null): NumericFilter {
  if (!raw) return null;
  const [op, value] = raw.split(":");
  const n = Number.parseFloat(value ?? "");
  if (!(NUMERIC_OPS as readonly string[]).includes(op) || !Number.isFinite(n)) return null;
  return { op: op as NumericOp, value: n };
}

export function advancedFilterFromParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AdvancedCardFilter {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const mode = get("colorMode");

  return {
    name: get("q") ?? "",
    colors: asColors(get("colors")),
    colorMode: (COLOR_MODES as readonly string[]).includes(mode ?? "")
      ? (mode as ColorMode)
      : "all",
    cmc: asNumeric(get("cmc")),
    type: get("type") ?? "",
    oracle: get("oracle") ?? "",
    set: get("set") ?? "",
    rarity: get("rarity") ?? "",
  };
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
 *  phrase) together as one token rather than breaking on the space inside. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /[^\s"]*"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query))) tokens.push(match[0]);
  return tokens;
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, "$1");

/** `wubrg` plus the handful of names Scryfall accepts for the same colours. */
const COLOR_ALIASES: Record<string, Color> = {
  w: "W",
  white: "W",
  u: "U",
  blue: "U",
  b: "B",
  black: "B",
  r: "R",
  red: "R",
  g: "G",
  green: "G",
  c: "C",
  colorless: "C",
};

function parseColorToken(rest: string): { colors: Color[]; mode: ColorMode } | null {
  for (const [op, mode] of [
    ["<=", "atMost"],
    ["=", "exactly"],
    [":", "all"],
  ] as const) {
    if (!rest.startsWith(op)) continue;
    const raw = rest.slice(op.length).toLowerCase();
    // "red,blue" is two colour names; "wu" is two colour letters run together.
    // A comma-separated part maps as a whole name first, and only falls back
    // to per-letter shorthand when it is not one.
    const colors = raw
      .split(",")
      .flatMap((part) => (COLOR_ALIASES[part] ? [COLOR_ALIASES[part]] : part.split("").map((c) => COLOR_ALIASES[c])))
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

/**
 * Reads as much of a literal Scryfall query as the structured panel covers.
 * Anything else recognisable as `key:value` syntax is reported unsupported
 * rather than folded into the name search, where it would silently match
 * nothing useful (searching for the literal text "is:foil", say).
 */
export function parseScryfallQuery(raw: string): ParsedScryfallQuery {
  const filter: AdvancedCardFilter = { ...EMPTY_ADVANCED_FILTER };
  const unsupported: string[] = [];
  const nameWords: string[] = [];

  for (const token of tokenize(raw.trim())) {
    const lower = token.toLowerCase();

    const colorMatch = lower.match(/^(?:c|color)(:|<=|=)(.+)$/);
    if (colorMatch) {
      const parsed = parseColorToken(colorMatch[1] + colorMatch[2]);
      if (parsed) {
        filter.colors = parsed.colors;
        filter.colorMode = parsed.mode;
        continue;
      }
    }

    const numeric = lower.match(/^(?:cmc|mv)(:|=|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (numeric) {
      const [, opText, valueText] = numeric;
      const op = NUMERIC_COMPARATORS.find(([o]) => o === opText)?.[1] ?? "eq";
      filter.cmc = { op, value: Number.parseFloat(valueText) };
      continue;
    }

    const typeMatch = token.match(/^(?:t|type):(.+)$/i);
    if (typeMatch) {
      filter.type = unquote(typeMatch[1]);
      continue;
    }

    const oracleMatch = token.match(/^(?:o|oracle):(.+)$/i);
    if (oracleMatch) {
      filter.oracle = unquote(oracleMatch[1]);
      continue;
    }

    const setMatch = token.match(/^(?:s|set):(.+)$/i);
    if (setMatch) {
      filter.set = unquote(setMatch[1]);
      continue;
    }

    const rarityMatch = token.match(/^(?:r|rarity):(.+)$/i);
    if (rarityMatch) {
      filter.rarity = unquote(rarityMatch[1]);
      continue;
    }

    // A recognisable `key:` or `key>=`-shaped clause that did not match one of
    // the facets above — flag it rather than guess.
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

/** The least a printing needs for `matchesAdvancedCard` to judge it. */
export type AdvancedMatchableCard = {
  colors: string[] | null;
};

/**
 * Colour matching, same rule as the collection filter: PostgREST's array
 * operators can express "contains" but not "exactly these" or "at most
 * these", so a query pre-filters everything it can (name, cmc, type, oracle,
 * set, rarity — see `route.ts`) and this finishes the colour comparison over
 * that already-narrow result.
 */
export function matchesAdvancedCard(card: AdvancedMatchableCard, filter: AdvancedCardFilter): boolean {
  return matchesColors(colorsOf(card.colors), filter.colors, filter.colorMode);
}
