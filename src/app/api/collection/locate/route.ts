import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { locateInCollection } from "@/lib/collection/queries";
import { MIN_TERM } from "@/lib/collection/locate";
import { capSuppliers } from "@/lib/social/wants";
import { matchFriendTradablesByTerm } from "@/lib/social/queries";

/**
 * "Where is my card?", for the header search.
 *
 * The same lookup the /find page runs, exposed so the dropdown can answer while
 * someone is still typing. RLS scopes it to the caller's own collection, so
 * there is nothing to authorise here beyond being signed in.
 *
 * Also carries the cross-person half /find shows: which friend has a matching
 * card open for trade. `matchFriendTradablesByTerm` is its own read, already
 * scoped by the friend-tradable-container policy — nothing here widens what a
 * friend has made visible.
 *
 * Never prerendered: the answer depends entirely on who is asking. Same reason
 * as /api/cards/[id].
 */
export const dynamic = "force-dynamic";

/** Enough to recognise the card you meant; the page is there for the rest. */
const MAX_RESULTS = 7;

/** A dropdown line has room for a name and a couple of suppliers, not a list. */
const MAX_SUPPLIERS_SHOWN = 3;

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_TERM) return NextResponse.json({ results: [], friends: [] });

  try {
    const [results, friendSearch] = await Promise.all([
      locateInCollection(q),
      matchFriendTradablesByTerm(q),
    ]);

    const friends = friendSearch.matches.map((match) => {
      const { shown, more } = capSuppliers(match.suppliers, MAX_SUPPLIERS_SHOWN);
      return {
        key: match.key,
        name: match.name,
        displayName: match.displayName,
        suppliers: shown.map((s) => ({
          username: friendSearch.suppliers.get(s.ownerId)?.username ?? "a friend",
          available: s.available,
          locations: s.locations,
        })),
        moreSuppliers: more,
      };
    });

    return NextResponse.json(
      { results: results.slice(0, MAX_RESULTS), total: results.length, friends },
      // A collection changes as it is edited, and this is keystroke-fresh by
      // nature; a cached answer would be worse than no answer.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed." },
      { status: 500 },
    );
  }
}
