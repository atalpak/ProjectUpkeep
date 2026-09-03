import { NextResponse } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Never prerendered.
 *
 * Without this, Next tries to generate static paths for the `[id]` segment and
 * the worker doing it dies — "Failed to generate static paths for
 * /api/cards/[id]" — which surfaces as an intermittent 500 and, in the panel,
 * as "Could not load that card". The sibling routes (search, printings) have no
 * dynamic segment, which is why only this one was affected.
 *
 * There is nothing to prerender in any case: the response depends on the
 * signed-in user's cookies, so every request has to reach the server.
 */
export const dynamic = "force-dynamic";

/**
 * Everything we know about one printing, for the card panel.
 *
 * Fetched on demand rather than joined into every list query: oracle text and
 * face data are large, and a collection page renders hundreds of rows of which
 * a person hovers a handful.
 *
 * `select("*")` is deliberate. The detail columns arrive in migration
 * 00000000000007, and naming them explicitly would make this route — and so the
 * whole panel — fail with a 400 on any database where that migration has not
 * been applied yet. With a star select the columns are simply absent until they
 * exist, and the panel renders what it has.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "No card id." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("scryfall_id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No such printing." }, { status: 404 });
  }

  // Deliberately not cached by the browser.
  //
  // An earlier version sent `private, max-age=3600` on the reasoning that cards
  // are immutable between syncs. They are — but a sync is exactly when they
  // change, and after the migration that added the detail columns every card
  // hovered beforehand kept serving its detail-less response for an hour, with
  // no request reaching the server to correct it. A backfill you cannot see the
  // results of is worse than a slightly chattier endpoint.
  //
  // Repeat hovers cost nothing anyway: the panel keeps every card it has
  // fetched in memory for the life of the page.
  return NextResponse.json(
    { card: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
