import { NextResponse, type NextRequest } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { nameVariants } from "@/lib/import/name-variants";
import { searchCards } from "@/lib/cards/search";
import {
  advancedFilterFromParams,
  isAdvancedFilterActive,
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
 *     or a `raw` literal-syntax query goes through `searchCards`
 *     (`src/lib/cards/search.ts`) — the direct-to-`cards` query neither this
 *     route nor the RPC above can express on its own, since the RPC knows
 *     nothing about colour, mana value, type, oracle text, set or rarity.
 *     That function is shared with the dedicated `/search` page, so the two
 *     surfaces can never quietly answer the same query differently.
 *
 * The header search bar (`HeaderSearch.tsx`) reaches the first path for a
 * plain name and, once what was typed parses as Scryfall syntax
 * (`parseScryfallQuery`), sends `raw` instead — the same syntax the `/search`
 * page's raw box takes, so a query "just works" wherever it is typed.
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

    const { data, error } = await searchCards(supabase, filter);
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
