import { NextResponse, type NextRequest } from "next/server";
import { specFromParams } from "@upkeep/domain";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { catalogSearchEnabled, searchCatalog } from "@/lib/cards/scryfall-search";

/**
 * Submitted catalog search: the whole query goes to Scryfall unchanged.
 * `GET /api/cards/search?q=<query>&page=1` plus the optional presentation
 * overrides `unique`, `order`, `dir`, `display`, `prefer`, `include_extras`,
 * `include_multilingual`, `include_variations`. Legacy `raw=` and facet
 * parameters are accepted and translated once (see `specFromParams`).
 *
 * Name suggestions while typing are a different job, done locally by
 * `/api/cards/suggestions`. Never cached at the HTTP layer: the session check
 * must run on every call and the shared data cache lives in the service.
 */
export const dynamic = "force-dynamic";

const STATUS = {
  validation: 400,
  syntax: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  unavailable: 503,
  bad_payload: 502,
} as const;

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json(
      { status: "error", kind: "unauthorized", message: "Not signed in.", warnings: [], submittedQuery: "" },
      { status: 401 },
    );
  }
  if (!catalogSearchEnabled()) {
    return NextResponse.json(
      { status: "error", kind: "unavailable", message: "Catalog search is switched off.", warnings: [], submittedQuery: "" },
      { status: 503 },
    );
  }

  const spec = specFromParams(request.nextUrl.searchParams);
  const result = await searchCatalog(await createClient(), spec);
  if (result.status === "ok") return NextResponse.json(result);

  const headers: Record<string, string> = {};
  if (result.retryAfterSeconds) headers["Retry-After"] = String(result.retryAfterSeconds);
  return NextResponse.json(result, { status: STATUS[result.kind], headers });
}
