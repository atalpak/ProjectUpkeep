/**
 * Advanced card search — the web app's half of the shared filter model:
 * the URL round trip, plus a thin re-export of everything else.
 *
 * The filter model, the literal-Scryfall-syntax reader, and the
 * colour/loyalty matching PostgREST can't express used to be duplicated here
 * — a second, web-only copy of `packages/upkeep-domain/src/card-search.ts`,
 * meant to agree with it but drifting on its own schedule. The same query
 * could give different results on web and phone. That copy is gone now;
 * everything below `EMPTY_ADVANCED_FILTER` down to `matchesAdvancedCard` is
 * re-exported from `@upkeep/domain` unchanged — see that module's header for
 * the actual reasoning, which belongs there now, not duplicated here.
 *
 * What stays web-only, because the phone app has no URL to round-trip
 * through: `advancedFilterToParams` / `advancedFilterFromParams`.
 */

import {
  COLORS,
  COLOR_MODES,
  NUMERIC_OPS,
  type AdvancedCardFilter,
  type Color,
  type ColorMode,
  type NumericFilter,
  type NumericOp,
} from "@upkeep/domain";

export {
  COLORS,
  COLOR_MODES,
  NUMERIC_OPS,
  EMPTY_ADVANCED_FILTER,
  isAdvancedFilterActive,
  advancedFacetCount,
  parseScryfallQuery,
  looksLikeScryfallSyntax,
  matchesNumeric,
  statToNumber,
  colorsOf,
  matchesColors,
  matchesAdvancedCard,
  type Color,
  type ColorMode,
  type NumericOp,
  type NumericFilter,
  type AdvancedCardFilter,
  type ParsedScryfallQuery,
  type AdvancedMatchableCard,
} from "@upkeep/domain";

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
  if (filter.loyalty) params.set("loyalty", `${filter.loyalty.op}:${filter.loyalty.value}`);
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
    loyalty: asNumeric(get("loyalty")),
    type: get("type") ?? "",
    oracle: get("oracle") ?? "",
    set: get("set") ?? "",
    rarity: get("rarity") ?? "",
  };
}
