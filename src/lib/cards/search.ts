import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { matchesAdvancedCard, type AdvancedCardFilter } from "@/lib/cards/search-query";

/**
 * The direct-to-`cards` query behind Advanced Search, shared by the header
 * dropdown's card lookup (`/api/cards/search`) and the dedicated `/search`
 * page — one query, two callers, so they can never quietly drift apart on
 * what "advanced" means.
 *
 * Reads public Scryfall data (`cards`, digital printings excluded), not a
 * user's own collection, so this needs no `owner_user_id` scoping — see
 * `.claude/rules/data-access.md`.
 */

export type CardSearchResult = {
  name: string;
  printing_count: number;
  /** Small crop — right for the header dropdown's compact thumbnail. */
  sample_image_uri: string | null;
  /** Full-resolution crop — for the `/search` page's own larger grid, where a
   *  small crop stretched up reads as blurry (the same fix the wish list's
   *  gallery view needed). */
  sample_image_uri_large: string | null;
  sample_card_id: string | null;
  sample_flavor_name: string | null;
};

type AdvancedRow = {
  name: string;
  flavor_name: string | null;
  image_uri: string | null;
  image_uri_small: string | null;
  scryfall_id: string;
  released_at: string | null;
  colors: string[] | null;
  loyalty: string | null;
};

/** Every request-scoped filter this query knows how to push into SQL, freshly
 *  applied — a query builder is single-use per execution, so paging needs a
 *  new one per page rather than reusing one across `.range()` calls. */
function buildFilteredQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: AdvancedCardFilter,
) {
  let query = supabase
    .from("cards")
    .select("name, flavor_name, image_uri, image_uri_small, scryfall_id, released_at, colors, loyalty")
    .eq("digital", false)
    .order("released_at", { ascending: false, nullsFirst: false });

  for (const word of filter.name.trim().split(/\s+/).filter(Boolean)) {
    query = query.ilike("name", `%${word}%`);
  }
  if (filter.type.trim()) query = query.ilike("type_line", `%${filter.type.trim()}%`);
  if (filter.oracle.trim()) query = query.ilike("oracle_text", `%${filter.oracle.trim()}%`);
  if (filter.set.trim()) query = query.eq("set_code", filter.set.trim().toLowerCase());
  if (filter.rarity.trim()) query = query.eq("rarity", filter.rarity.trim().toLowerCase());
  if (filter.cmc) {
    const { op, value } = filter.cmc;
    if (op === "eq") query = query.eq("cmc", value);
    else if (op === "ne") query = query.neq("cmc", value);
    else if (op === "gt") query = query.gt("cmc", value);
    else if (op === "gte") query = query.gte("cmc", value);
    else if (op === "lt") query = query.lt("cmc", value);
    else query = query.lte("cmc", value);
  }
  // "any" colour overlap narrows the SQL fetch; "all"/"exactly"/"atMost" all
  // need the exact set comparison `matchesAdvancedCard` does below, so they
  // fall back to the widest useful pre-filter (any overlap) rather than none.
  if (filter.colors.length > 0) query = query.overlaps("colors", filter.colors);

  return query;
}

/** PostgREST's own response cap, independent of whatever `.limit()`/`.range()`
 *  asks for — confirmed against this project's Supabase instance, not
 *  documented anywhere `searchCards` could read it from. A single request
 *  asking for more than this silently gets this many back with no error,
 *  which is a second, sneakier version of the "cap too tight, no one is
 *  told" bug the loyalty search timeout turned out to be — so this fetches
 *  in pages rather than trusting one big `.limit()` to work. */
const POSTGREST_MAX_ROWS = 1000;

/** See the module-level comment on why this needs to be generous: colour and
 *  loyalty are matched in application code after the fetch, over whatever a
 *  type/oracle/etc `WHERE` clause already narrowed it to, ordered
 *  newest-first — too tight a cap silently drops older matching cards. */
const FETCH_CAP = 2000;

async function fetchMatchingRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: AdvancedCardFilter,
): Promise<{ data: AdvancedRow[]; error: string | null }> {
  const rows: AdvancedRow[] = [];

  for (let from = 0; from < FETCH_CAP; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, FETCH_CAP) - 1;
    const { data, error } = await buildFilteredQuery(supabase, filter)
      .range(from, to)
      .returns<AdvancedRow[]>();

    if (error) return { data: [], error: error.message };
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < to - from + 1) break; // last page was short of full
  }

  return { data: rows, error: null };
}

/**
 * Fetches a generously capped set of matching printings and groups them by
 * name — `sample_*` picked from the newest printing, the same heuristic
 * `search_card_names` uses for the plain-name path — rather than adding a
 * second SQL function to keep in step with the first.
 */
export async function searchCards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: AdvancedCardFilter,
  // The dropdown caps at 30 — a compact list, not a browse. The dedicated
  // `/search` page asks for more, since a full page of results is the point.
  resultLimit = 30,
): Promise<{ data: CardSearchResult[]; error: string | null }> {
  const { data, error } = await fetchMatchingRows(supabase, filter);
  if (error) return { data: [], error };

  const matching = data.filter((row) => matchesAdvancedCard(row, filter));

  const byName = new Map<string, CardSearchResult>();
  for (const row of matching) {
    const existing = byName.get(row.name);
    if (existing) {
      existing.printing_count += 1;
      continue;
    }
    byName.set(row.name, {
      name: row.name,
      printing_count: 1,
      sample_image_uri: row.image_uri_small,
      sample_image_uri_large: row.image_uri,
      sample_card_id: row.scryfall_id,
      sample_flavor_name: row.flavor_name,
    });
  }

  const results = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, resultLimit);
  return { data: results, error: null };
}
