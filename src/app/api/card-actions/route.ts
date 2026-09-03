import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { getDecks, getLocations, locateInCollection } from "@/lib/collection/queries";

/**
 * Everything the card popup's action panel needs, in one call.
 *
 * The popup opens over any card — owned or not — so it cannot rely on data the
 * page already loaded. This gathers what "add to collection" and "add to deck"
 * need (the user's locations and decks) plus whether they already own this
 * card and where those copies sit.
 *
 * Never prerendered: it is all per-user.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";

  try {
    const [decks, locations, located] = await Promise.all([
      getDecks(),
      getLocations(),
      name ? locateInCollection(name) : Promise.resolve([]),
    ]);

    // The located rows are grouped by oracle id; pick the one whose name is the
    // card we are looking at (a search term can be a fragment).
    const mine = located.find((c) => c.name.toLowerCase() === name.toLowerCase());

    return NextResponse.json({
      decks: decks.map((d) => ({ id: d.id, name: d.name })),
      locations: locations.map((l) => ({ id: l.id, name: l.name, type: l.type })),
      owned: mine
        ? { total: mine.total, available: mine.available, places: mine.places }
        : { total: 0, available: 0, places: [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
