import { NextResponse, type NextRequest } from "next/server";
import { createClient as createBearerClient } from "@supabase/supabase-js";
import { authenticateRequest } from "@/lib/auth/request-auth";
import { publicSupabaseConfig } from "@/lib/env";
import { localPrintingIds, ownershipFor } from "@/lib/cards/search-enrichment";
import { specFromParams, setOnlyCode } from "@upkeep/domain";

import { createClient } from "@/lib/supabase/server";
import { searchCatalog } from "@/lib/cards/scryfall-search";

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
  const supabase = await authenticateRequest(
    request.headers.get("authorization"),
    createClient,
    (token) => {
      const { url, anonKey } = publicSupabaseConfig();
      return createBearerClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    },
    async (client, token) => {
      const { data, error } = await client.auth.getUser(token);
      return !error && !!data.user;
    },
  );
  if (!supabase) {
    return NextResponse.json(
      { status: "error", kind: "unauthorized", message: "Not signed in.", warnings: [], submittedQuery: "" },
      { status: 401 },
    );
  }
  const spec = specFromParams(request.nextUrl.searchParams);
  const setGallery = setOnlyCode(spec.q) !== null && spec.unique === undefined && spec.order === undefined;
  const result = await searchCatalog(supabase, setGallery ? { ...spec, unique: "prints", order: "set" } : spec);
  if (result.status === "ok") {
    // Mobile needs exact-printing eligibility; upstream-only cards remain view-only.
    const localIds = await localPrintingIds(supabase, result.cards.map(c => c.id));
    if (request.nextUrl.searchParams.get("owned_only") === "true") {
      const { data: { user } } = await supabase.auth.getUser();
      const owned = user ? await ownershipFor(supabase, user.id, result.cards.map(c => ({ id: c.id, oracleId: c.oracleId }))) : null;
      if (!owned) return NextResponse.json({ status: "error", kind: "unavailable", message: "Could not load your collection. Try again.", warnings: [], submittedQuery: spec.q }, { status: 503 });
      return NextResponse.json({ ...result, cards: result.cards.filter(c => (owned[c.id]?.exact ?? 0) + (owned[c.id]?.otherPrintings ?? 0) > 0), localPrintingIds: localIds });
    }
    return NextResponse.json({ ...result, localPrintingIds: localIds });
  }

  const headers: Record<string, string> = {};
  if (result.retryAfterSeconds) headers["Retry-After"] = String(result.retryAfterSeconds);
  return NextResponse.json(result, { status: STATUS[result.kind], headers });
}
