import { type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { getWantExportRows } from "@/lib/social/queries";
import { wantsToCsv, wantsToDecklistText } from "@/lib/social/want-export";

/**
 * The wish list as a downloadable file — the wants-page counterpart of
 * /api/collection/export. A want list is small enough that inlining it into
 * the page (as the deck export still does) would be fine too, but generating
 * it on request keeps this consistent with the collection's own pattern and
 * leaves room for the list to grow without the page paying for it.
 */
export const dynamic = "force-dynamic";

const FORMATS = new Set(["csv", "txt"]);

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return new Response("Not signed in.", { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  if (!FORMATS.has(format)) {
    return new Response("Unknown format.", { status: 400 });
  }

  try {
    const rows = await getWantExportRows();
    const body = format === "csv" ? wantsToCsv(rows) : wantsToDecklistText(rows);

    return new Response(body, {
      headers: {
        "Content-Type":
          format === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
        "Content-Disposition": `attachment; filename="wish-list.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Export failed.", {
      status: 500,
    });
  }
}
