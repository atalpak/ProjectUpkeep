import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { locateInCollection } from "@/lib/collection/queries";
import { MIN_TERM } from "@/lib/collection/locate";

/**
 * "Where is my card?", for the header search.
 *
 * The same lookup the /find page runs, exposed so the dropdown can answer while
 * someone is still typing. RLS scopes it to the caller's own collection, so
 * there is nothing to authorise here beyond being signed in.
 *
 * Never prerendered: the answer depends entirely on who is asking. Same reason
 * as /api/cards/[id].
 */
export const dynamic = "force-dynamic";

/** Enough to recognise the card you meant; the page is there for the rest. */
const MAX_RESULTS = 7;

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_TERM) return NextResponse.json({ results: [] });

  try {
    const results = await locateInCollection(q);
    return NextResponse.json(
      { results: results.slice(0, MAX_RESULTS), total: results.length },
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
