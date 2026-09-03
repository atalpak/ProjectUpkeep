import { NextResponse, type NextRequest } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { nameVariants } from "@/lib/import/name-variants";

/**
 * Autocomplete step 1: card names matching a fragment.
 *
 * Backed by the local `cards` table (populated by the Scryfall sync), not by
 * Scryfall's API. Searching our own copy means autocomplete stays fast, works
 * offline, and does not hammer a free service on every keystroke.
 */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  // Two characters is where the result set stops being "most of the database".
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();

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
