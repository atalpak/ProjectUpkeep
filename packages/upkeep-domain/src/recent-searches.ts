/**
 * Recent searches — the pure list rule shared by web and mobile.
 *
 * A per-device convenience, not data anyone else needs to see, so each
 * platform persists it its own way (web: `localStorage`, `src/lib/search/
 * recent-searches.ts`; mobile: `expo-secure-store`, `apps/mobile/src/
 * recentSearches.ts`) and both call this for the one rule that actually
 * matters: what the list looks like after a new term is recorded.
 */

/** Enough to be useful without turning into a second search history. */
export const MAX_RECENT_SEARCHES = 6;

/**
 * Records a settled search, most recent first, deduplicated case-insensitively
 * and capped at `max`. Re-searching something already on the list just moves
 * it to the front rather than listing it twice.
 */
export function pushRecentSearch(
  existing: string[],
  term: string,
  max: number = MAX_RECENT_SEARCHES,
): string[] {
  const trimmed = term.trim();
  if (trimmed === "") return existing;

  const withoutDuplicate = existing.filter((t) => t.toLowerCase() !== trimmed.toLowerCase());
  return [trimmed, ...withoutDuplicate].slice(0, max);
}
