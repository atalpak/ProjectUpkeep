import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { getNotifications } from "@/lib/social/queries";

/**
 * The alerts behind the header badge.
 *
 * Fetched on open rather than rendered into the layout: the layout runs on
 * every page in the app, and loading a list nobody may look at would put a
 * query on every navigation to save one on the rare click.
 *
 * Never prerendered, never cached — the badge exists to be current.
 */
export const dynamic = "force-dynamic";

const MAX = 8;

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX) : MAX;

  try {
    const notifications = await getNotifications(limit);
    return NextResponse.json(
      { notifications },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load alerts." },
      { status: 500 },
    );
  }
}
