/**
 * Recent header searches — a per-browser convenience, not data anyone else
 * needs to see, so `localStorage` rather than a table and a migration.
 *
 * Split the way `LocationManager.tsx`'s collapsed-sections state is: the pure
 * "what does the list look like after this happens" rule lives here and is
 * tested directly, while the actual read/write goes through `try`/`catch`
 * because `localStorage` throws in a locked-down browser (Safari private
 * mode, some corporate policies) and a search bar has no business crashing
 * over that — it just stops remembering.
 */

const STORAGE_KEY = "project-upkeep-recent-searches";

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

export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentSearch(term: string): string[] {
  const next = pushRecentSearch(readRecentSearches(), term);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable or full — the search itself still worked, it
    // just will not be remembered next time.
  }
  return next;
}
