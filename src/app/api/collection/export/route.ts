import { type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { getCollection } from "@/lib/collection/queries";
import { filterFromParams } from "@/lib/collection/filters";
import { stackToExportRow, stacksToDecklistText, toCsv } from "@/lib/collection/export";

/**
 * The collection as a downloadable file, generated on request.
 *
 * Previously both the CSV and the decklist were built on the collection page
 * and handed to the Export dropdown as props — reasonable while the page
 * already held every row, and the reason the component's own comment argues
 * against a second request. Paginating the page invalidates that: it no longer
 * has the rows to serialise. (Measured on a 688-entry collection the inlined
 * text was ~51KB of a 1.7MB page — worth removing, and it grows without bound
 * with the collection, but the row payload is the part that matters.)
 *
 * Takes the same filter parameters as /collection, so "export what I am
 * looking at" stays true.
 */
export const dynamic = "force-dynamic";

const FORMATS = new Set(["csv", "txt"]);

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return new Response("Not signed in.", { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const format = params.get("format") ?? "csv";
  if (!FORMATS.has(format)) {
    return new Response("Unknown format.", { status: 400 });
  }

  const filter = filterFromParams(Object.fromEntries(params));

  try {
    // Unpaginated by design: an export is the whole filtered set, not a page.
    const collection = await getCollection(filter);
    const rows = collection.rows.map(stackToExportRow);

    const body =
      format === "csv"
        ? toCsv(rows, { includeLocation: true })
        : stacksToDecklistText(rows);

    // The filename mirrors what the page calls the view, so an exported file is
    // recognisable weeks later.
    const base = params.get("filtered") === "1" ? "collection-filtered" : "collection";

    return new Response(body, {
      headers: {
        "Content-Type":
          format === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.${format}"`,
        // Per-user data that changes as the collection does.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Export failed.", {
      status: 500,
    });
  }
}
