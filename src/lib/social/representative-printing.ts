/**
 * Picking a default printing for a wish-list entry added by name.
 *
 * Pure logic, split out of `wants/actions.ts` (a `"use server"` file) rather
 * than living there: Next's Server Actions convention requires every export
 * from a `"use server"` file to be an async function, so a plain sync helper
 * like this one has to live somewhere else even though `actions.ts` is its
 * only caller.
 */

/** Rank printings so a want row shows a normal copy, not a promo or a token. */
const SET_TYPE_RANK: Record<string, number> = {
  core: 0,
  expansion: 0,
  draft_innovation: 1,
  commander: 1,
  masters: 2,
  starter: 3,
};

export type PrintingPick = {
  scryfall_id: string;
  released_at: string | null;
  set_type: string | null;
  digital: boolean;
  set_code: string | null;
  collector_number: string | null;
  available_finishes: string[] | null;
};

// A card's printings inside one set share a release date, so sorting by
// set-type rank then release date alone leaves a tie between same-set
// printings (a regular card and its showcase/extended-art/foil-only
// treatments) to fall through to whatever order the database happened to
// return. packages/scan-core's `regularFirst` hit the identical bug on the
// scanner side (a footer read once opened a foil-only showcase printing
// instead of the ordinary card) and fixed it the same way: prefer a plain
// collector number, then one available nonfoil, then the lowest number.
// Duplicated rather than imported — scan-core is not one of the packages
// web code is meant to import from (see CLAUDE.md's directory map; only
// packages/upkeep-domain is shared in both directions) — but the tie-break
// itself should stay identical if `regularFirst` ever changes.
function isPlainNumber(collectorNumber: string | null): boolean {
  return /^\d+$/.test(collectorNumber ?? "");
}

export function pickRepresentative(rows: PrintingPick[]): string | null {
  const usable = rows.filter((r) => !r.digital);
  const pool = usable.length > 0 ? usable : rows;
  if (pool.length === 0) return null;

  return [...pool].sort((a, b) => {
    const ra = SET_TYPE_RANK[a.set_type ?? ""] ?? 5;
    const rb = SET_TYPE_RANK[b.set_type ?? ""] ?? 5;
    if (ra !== rb) return ra - rb;
    // Newest of the preferred kind first...
    const dateCompare = (b.released_at ?? "").localeCompare(a.released_at ?? "");
    if (dateCompare !== 0) return dateCompare;
    // ...but printings released the same day (almost always the same set)
    // need their own tie-break: a plain collector number over a promo/star
    // suffix, then one that can be had nonfoil, then the lowest number.
    const aPlain = isPlainNumber(a.collector_number);
    const bPlain = isPlainNumber(b.collector_number);
    if (aPlain !== bPlain) return aPlain ? -1 : 1;
    const aNonfoil = (a.available_finishes ?? []).includes("nonfoil");
    const bNonfoil = (b.available_finishes ?? []).includes("nonfoil");
    if (aNonfoil !== bNonfoil) return aNonfoil ? -1 : 1;
    if (aPlain && bPlain) {
      const diff = parseInt(a.collector_number ?? "", 10) - parseInt(b.collector_number ?? "", 10);
      if (diff !== 0) return diff;
    }
    return (a.set_code ?? "").localeCompare(b.set_code ?? "") || a.scryfall_id.localeCompare(b.scryfall_id);
  })[0].scryfall_id;
}
