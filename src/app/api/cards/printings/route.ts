import { NextResponse, type NextRequest } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Autocomplete step 2: every printing of one card name.
 *
 * Exact name match, newest printing first — when someone adds a card they most
 * often just opened it, and the newest printing is the best default.
 */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ printings: [] });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select(
      "scryfall_id, name, set_code, set_name, collector_number, rarity, " +
        "released_at, image_uri, image_uri_small, available_finishes, lang, digital",
    )
    .eq("name", name)
    .eq("digital", false)
    .order("released_at", { ascending: false, nullsFirst: false })
    .order("collector_number", { ascending: true })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ printings: data ?? [] });
}
