import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { foldOwnership, type OwnedRow, type OwnershipNote, type ResultIdentity } from "@/lib/cards/search-enrichment-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Ownership notes for one page of search results, in two batched queries keyed
 * by the identities the search actually returned. Scoped to the signed-in
 * owner explicitly — RLS also exposes friends' tradable rows, so the filter is
 * required (CLAUDE.md constraint 3). Returns null on failure: the catalog
 * results stay visible and the page says annotations are unavailable.
 */
export async function ownershipFor(
  supabase: Supabase,
  userId: string,
  results: ResultIdentity[],
): Promise<Record<string, OwnershipNote> | null> {
  if (results.length === 0) return {};
  const ids = results.map((r) => r.id);
  const oracleIds = [...new Set(results.map((r) => r.oracleId).filter((o): o is string => o !== null))];

  // Chunked so a 175-card page does not put ~7KB of ids in one GET URL.
  const CHUNK = 60;
  type Row = { id: string; card_id: string; quantity: number; cards: { oracle_id: string | null } | null };
  const rows: Row[] = [];
  const pull = async (column: "card_id" | "cards.oracle_id", values: string[]): Promise<boolean> => {
    for (let i = 0; i < values.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("card_instances")
        .select("id, card_id, quantity, cards!inner ( oracle_id )")
        .eq("owner_user_id", userId)
        .in(column, values.slice(i, i + CHUNK));
      if (error) return false;
      rows.push(...((data ?? []) as unknown as Row[]));
    }
    return true;
  };
  if (!(await pull("card_id", ids)) || !(await pull("cards.oracle_id", oracleIds))) return null;

  // The two pulls overlap (an exact printing shares its Oracle id); count each stack row once.
  const stacks = new Map<string, OwnedRow>();
  for (const row of rows) {
    stacks.set(row.id, { card_id: row.card_id, oracle_id: row.cards?.oracle_id ?? null, quantity: row.quantity });
  }
  return foldOwnership(results, [...stacks.values()]);
}

/**
 * Which of these printings exist in the local `cards` mirror (public data, no
 * owner scope needed). Adds need a local row, so upstream-only results are
 * view-only. Null on failure: callers then stay permissive rather than
 * disabling actions on a guess.
 */
export async function localPrintingIds(supabase: Supabase, ids: string[]): Promise<string[] | null> {
  const found: string[] = [];
  for (let i = 0; i < ids.length; i += 60) {
    const { data, error } = await supabase.from("cards").select("scryfall_id").in("scryfall_id", ids.slice(i, i + 60));
    if (error) return null;
    found.push(...(data ?? []).map((r: { scryfall_id: string }) => r.scryfall_id));
  }
  return found;
}
