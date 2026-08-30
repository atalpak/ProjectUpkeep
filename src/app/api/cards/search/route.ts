import { NextResponse, type NextRequest } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

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
  const { data, error } = await supabase.rpc("search_card_names", {
    q,
    result_limit: 15,
    include_digital: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}
