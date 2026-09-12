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
  sample_image_uri: string | null;
  sample_card_id: string | null;
  sample_flavor_name: string | null;
};

type AdvancedRow = {
  name: string;
  flavor_name: string | null;
  image_uri_small: string | null;
  scryfall_id: string;
  released_at: string | null;
  colors: string[] | null;
  loyalty: string | null;
};

/**
 * Fetches a generously capped set of matching printings and groups them by
 * name — `sample_*` picked from the newest printing, the same heuristic
 * `search_card_names` uses for the plain-name path — rather than adding a
 * second SQL function to keep in step with the first.
 *
 * The cap has to be generous enough to survive colour and loyalty, the two
 * facets `matchesAdvancedCard` finishes in application code rather than SQL —
 * everything else here (name, cmc, type, oracle, set, rarity) is already a
 * `WHERE` clause, so the cap only has to cover how many printings can match
 * *those* before the rest narrows it further. A type like "planeswalker"
 * alone can be a few thousand printings across every reprint, and this is
 * ordered newest-first, so a cap too tight silently drops older cards from a
 * loyalty search rather than erroring — 2000 is comfortably past any single
 * type line's printing count.
 */
export async function searchCards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: AdvancedCardFilter,
  // The dropdown caps at 30 — a compact list, not a browse. The dedicated
  // `/search` page asks for more, since a full page of results is the point.
  resultLimit = 30,
): Promise<{ data: CardSearchResult[]; error: string | null }> {
  let query = supabase
    .from("cards")
    .select("name, flavor_name, image_uri_small, scryfall_id, released_at, colors, loyalty")
    .eq("digital", false)
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(2000);

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

  const { data, error } = await query.returns<AdvancedRow[]>();
  if (error) return { data: [], error: error.message };

  const matching = (data ?? []).filter((row) => matchesAdvancedCard(row, filter));

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
      sample_card_id: row.scryfall_id,
      sample_flavor_name: row.flavor_name,
    });
  }

  const results = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, resultLimit);
  return { data: results, error: null };
}
