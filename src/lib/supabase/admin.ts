import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig, serviceRoleKey } from "@/lib/env";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Used only by the Scryfall sync job (scripts/sync-scryfall.ts), which writes
 * to `cards` and `scryfall_sync_runs` — tables that no end user may write to.
 *
 * The `server-only` import above makes importing this from a Client Component a
 * build error rather than a security incident.
 */
export function createAdminClient() {
  const { url } = publicSupabaseConfig();
  return createSupabaseClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
