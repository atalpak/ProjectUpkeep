import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { getDecks, getLocations, locateInCollection } from "@/lib/collection/queries";
import { cardKey } from "@/lib/collection/availability";
import { getFriendCardSuppliers } from "@/lib/social/queries";

/**
 * Everything the card popup's action panel needs, in one call.
 *
 * The popup opens over any card — owned or not — so it cannot rely on data the
 * page already loaded. This gathers what "add to collection" and "add to deck"
 * need (the user's locations and decks), whether the signed-in user already
 * owns this card and where those copies sit, and which friends have it open
 * for trade — this printing or another one of the same card.
 *
 * Never prerendered: it is all per-user.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  // The printing being viewed, and its oracle id if it has one — the panel
  // already knows both (they are fields on the `Card` it was opened with),
  // so there is no reason to re-derive them from `name` alone. Together they
  // give the same key `cardKey` uses everywhere else, plus the exact printing
  // needed to tell "this printing" apart from "another printing".
  const cardId = request.nextUrl.searchParams.get("cardId")?.trim() ?? "";
  const oracleId = request.nextUrl.searchParams.get("oracleId")?.trim() || null;

  try {
    const [decks, locations, located, friends] = await Promise.all([
      getDecks(),
      getLocations(),
      name ? locateInCollection(name) : Promise.resolve([]),
      name && cardId
        ? getFriendCardSuppliers(cardId, cardKey({ oracle_id: oracleId, name }) ?? `id:${cardId}`)
        : Promise.resolve({ suppliers: [], profiles: new Map() }),
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
      friends: friends.suppliers.map((s) => ({
        username: friends.profiles.get(s.ownerId)?.username ?? "a friend",
        count: s.count,
        samePrinting: s.samePrinting,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
