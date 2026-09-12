import { NextResponse, type NextRequest } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { nameVariants } from "@/lib/import/name-variants";
import {
  advancedFilterFromParams,
  isAdvancedFilterActive,
  matchesAdvancedCard,
  parseScryfallQuery,
  type AdvancedCardFilter,
} from "@/lib/cards/search-query";

/**
 * Autocomplete step 1: card names matching a fragment — or, once Advanced
 * Search is in play, matching a set of Scryfall-style facets.
 *
 * Backed by the local `cards` table (populated by the Scryfall sync), not by
 * Scryfall's API. Searching our own copy means autocomplete stays fast, works
 * offline, and does not hammer a free service on every keystroke.
 *
 * Two paths, chosen by what the caller sent:
 *   - A bare `q` goes through `search_card_names`, the RPC this route always
 *     used — unchanged, so basic search behaves exactly as before.
 *   - Any advanced facet (`colors`, `cmc`, `type`, `oracle`, `set`, `rarity`)
 *     or a `raw` literal-syntax query selects everything itself, straight
 *     from `cards` (public Scryfall data — no owner scoping needed, see
 *     `.claude/rules/data-access.md`), and groups the matching printings by
 *     name in application code the way the RPC does in SQL. Colour matching
 *     ("exactly these", "at most these") has no clean PostgREST equivalent, so
 *     the query narrows by everything else and `matchesAdvancedCard` finishes
 *     the job — the same split `collection/filters.ts` makes.
 */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim() ?? "";
  const raw = params.get("raw")?.trim() ?? "";
  const structured = advancedFilterFromParams(params);
  const advancedRequested = raw !== "" || isAdvancedFilterActive({ ...structured, name: "" });

  const supabase = await createClient();

  if (advancedRequested) {
    let filter: AdvancedCardFilter = { ...structured, name: q || structured.name };
    let unsupported: string[] = [];

    if (raw !== "") {
      const parsed = parseScryfallQuery(raw);
      // The raw box speaks for the whole query when it is used — mixing it
      // with whatever the structured controls happen to hold would mean two
      // sources of truth for the same search.
      filter = parsed.filter;
      unsupported = parsed.unsupported;
    }

    if (filter.name.trim().length < 2 && !isAdvancedFilterActive({ ...filter, name: "" })) {
      return NextResponse.json({ results: [], unsupported });
    }

    const { data, error } = await advancedSearch(supabase, filter);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ results: data, unsupported });
  }

  // Two characters is where the result set stops being "most of the database".
  if (q.length < 2) return NextResponse.json({ results: [] });

  const lookup = (term: string) =>
    supabase.rpc("search_card_names", {
      q: term,
      result_limit: 15,
      include_digital: false,
    });

  const { data, error } = await lookup(q);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A two-part card pasted whole ("Lorehold Archivist / Restore Relic") matches
  // nothing, because the database spells it with a double slash. Rather than
  // teach the SQL about separators, retry with the other spellings — only when
  // the first attempt found nothing, so the common case stays one round trip.
  if ((data ?? []).length === 0 && q.includes("/")) {
    for (const variant of nameVariants(q).slice(1)) {
      const retry = await lookup(variant);
      if (!retry.error && (retry.data ?? []).length > 0) {
        return NextResponse.json({ results: retry.data });
      }
    }
  }

  return NextResponse.json({ results: data ?? [] });
}

type AdvancedRow = {
  name: string;
  flavor_name: string | null;
  image_uri_small: string | null;
  scryfall_id: string;
  released_at: string | null;
  colors: string[] | null;
};

/**
 * The direct-to-`cards` query the RPC cannot do, because it has no idea about
 * colour, mana value, type, oracle text, set or rarity. Fetches a generously
 * capped set of matching printings and groups them by name — `sample_*`
 * picked from the newest printing, same heuristic `search_card_names` uses —
 * rather than adding a second SQL function to keep in step with the first.
 */
async function advancedSearch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: AdvancedCardFilter,
) {
  let query = supabase
    .from("cards")
    .select("name, flavor_name, image_uri_small, scryfall_id, released_at, colors")
    .eq("digital", false)
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(600);

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

  const byName = new Map<
    string,
    { name: string; printing_count: number; sample_image_uri: string | null; sample_card_id: string | null; sample_flavor_name: string | null }
  >();
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

  const results = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
  return { data: results, error: null };
}
