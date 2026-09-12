import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { matchSuppliersForCard } from "@/lib/social/queries";

/**
 * Which friends have a card open for trade, for a card that is not (yet) on
 * the wish list.
 *
 * The wish list page itself resolves this for every saved want in one query
 * (`getWantListView`); this is the same answer for a draft row on /wants that
 * has not been added — the printing picker's oracle id, or the name fallback,
 * is the same `key` `cardKey()` computes everywhere else.
 *
 * Never prerendered: the result depends on the signed-in user's friends.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!key) return NextResponse.json({ suppliers: [] });

  try {
    const { suppliers, profiles } = await matchSuppliersForCard(key);

    return NextResponse.json({
      suppliers: suppliers.map((s) => ({
        username: profiles.get(s.ownerId)?.username ?? "a friend",
        available: s.available,
        locations: s.locations,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
