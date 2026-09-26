/**
 * Pure fold behind result annotations: given the copies a user owns, say for
 * each search result whether they own that exact printing, or only another
 * printing of the same card (matched by Oracle id, never by name).
 * Annotations only decorate results — they never filter or reorder them.
 */

export type OwnedRow = { card_id: string; oracle_id: string | null; quantity: number };
export type ResultIdentity = { id: string; oracleId: string | null };
export type OwnershipNote = { exact: number; otherPrintings: number };

export function foldOwnership(results: ResultIdentity[], owned: OwnedRow[]): Record<string, OwnershipNote> {
  const byPrinting = new Map<string, number>();
  const byOracle = new Map<string, number>();
  for (const row of owned) {
    byPrinting.set(row.card_id, (byPrinting.get(row.card_id) ?? 0) + row.quantity);
    if (row.oracle_id) byOracle.set(row.oracle_id, (byOracle.get(row.oracle_id) ?? 0) + row.quantity);
  }
  const out: Record<string, OwnershipNote> = {};
  for (const r of results) {
    const exact = byPrinting.get(r.id) ?? 0;
    const sameCard = r.oracleId ? (byOracle.get(r.oracleId) ?? 0) : 0;
    if (exact > 0 || sameCard > 0) out[r.id] = { exact, otherPrintings: Math.max(0, sameCard - exact) };
  }
  return out;
}
