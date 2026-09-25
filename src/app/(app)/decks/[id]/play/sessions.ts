import "server-only";

import { createClient } from "@/lib/supabase/server";
import { readPreview, type SessionSummary, type ShareSummary } from "@/lib/playtest/session";

/**
 * Read-only loaders for the play page: the caller's saved games and shares for
 * one deck. Not a "use server" file (these run during the page render, they are
 * not callable from the browser) and READ-ONLY by construction:
 * `scripts/playtest-boundary.test.ts` fails if a write verb appears here.
 *
 * Every query filters on BOTH `owner_user_id` and `deck_id`. RLS already makes
 * these tables owner-only, but the filter is what makes the query mean "mine
 * for this deck" rather than "whatever RLS lets through" (CLAUDE.md constraint
 * 3), and it costs nothing.
 *
 * A database that has not had migrations 46/47 applied yet answers 42P01 (or
 * PostgREST's PGRST205). That must not take the whole play page down, since
 * the tabletop itself needs neither table, so it is reported as
 * `available: false` and the page simply offers no account saves. Code that
 * reads these tables is still meant to land AFTER the migration; this is the
 * seatbelt, not the plan.
 */

export type SavesState = {
  available: boolean;
  sessions: SessionSummary[];
  shares: ShareSummary[];
};

function missingTable(error: { code?: string | null } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function loadSaves(deckId: string, userId: string): Promise<SavesState> {
  const supabase = await createClient();

  const [sessionsResult, sharesResult] = await Promise.all([
    supabase
      .from("playtest_sessions")
      .select("id, title, updated_at, source_fingerprint, preview")
      .eq("owner_user_id", userId)
      .eq("deck_id", deckId)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("playtest_shares")
      .select("id, token, title, show_hand, expires_at, updated_at")
      .eq("owner_user_id", userId)
      .eq("deck_id", deckId)
      .gt("expires_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  if (missingTable(sessionsResult.error) || missingTable(sharesResult.error)) {
    return { available: false, sessions: [], shares: [] };
  }
  if (sessionsResult.error) throw new Error(`Could not load saved games: ${sessionsResult.error.message}`);
  if (sharesResult.error) throw new Error(`Could not load shared tables: ${sharesResult.error.message}`);

  return {
    available: true,
    sessions: (sessionsResult.data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      updatedAt: row.updated_at as string,
      sourceFingerprint: row.source_fingerprint as string,
      preview: readPreview(row.preview),
    })),
    shares: (sharesResult.data ?? []).map((row) => ({
      id: row.id as string,
      token: row.token as string,
      title: row.title as string,
      showHand: row.show_hand as boolean,
      expiresAt: row.expires_at as string,
      updatedAt: row.updated_at as string,
    })),
  };
}

/** One saved game's snapshot, for `?session=<id>`. Owner- and deck-filtered;
 *  null when it does not exist or is not the caller's. */
export async function loadSession(
  deckId: string,
  userId: string,
  sessionId: string,
): Promise<{ id: string; title: string; updatedAt: string; snapshot: unknown } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playtest_sessions")
    .select("id, title, updated_at, snapshot")
    .eq("id", sessionId)
    .eq("owner_user_id", userId)
    .eq("deck_id", deckId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return { id: data.id as string, title: data.title as string, updatedAt: data.updated_at as string, snapshot: data.snapshot };
}
