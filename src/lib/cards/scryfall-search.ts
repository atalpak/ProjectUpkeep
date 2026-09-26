import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { SearchResponse, SearchSpec } from "@upkeep/domain";
import { searchCatalog as run, suggestSpelling as suggest, type SearchDeps } from "@/lib/cards/scryfall-search-core";

export { catalogSearchEnabled } from "@/lib/cards/scryfall-search-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Binds the search core to the signed-in user's Supabase client for the shared
 * traffic gate (migration 48). The core holds the behaviour and is what the
 * unit tests exercise; this file only wires it up.
 */
function depsFor(supabase: Supabase): SearchDeps {
  return {
    async claimSlot(gapMs, maxWaitMs) {
      const { data, error } = await supabase.rpc("claim_scryfall_slot", { gap_ms: gapMs, max_wait_ms: maxWaitMs });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) return { ok: false };
      return { ok: true, granted: row.granted, waitMs: row.wait_ms, cooldownMs: row.cooldown_ms };
    },
    async openCooldown(seconds) {
      await supabase.rpc("open_scryfall_cooldown", { seconds });
    },
  };
}

export const searchCatalog = (supabase: Supabase, spec: SearchSpec): Promise<SearchResponse> =>
  run(depsFor(supabase), spec);

export const suggestSpelling = (supabase: Supabase, q: string): Promise<string | null> =>
  suggest(depsFor(supabase), q);
