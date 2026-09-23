/**
 * Recent header searches — a per-browser convenience, not data anyone else
 * needs to see, so `localStorage` rather than a table and a migration.
 *
 * The list rule itself (`pushRecentSearch`) moved to `packages/upkeep-domain`
 * so the phone app can share it (same pattern as `src/lib/collection/
 * stacking.ts`) — re-exported here so this file's existing importers and
 * `scripts/recent-searches.test.ts` are unchanged. What stays web-only is the
 * storage: read/write goes through `try`/`catch` because `localStorage`
 * throws in a locked-down browser (Safari private mode, some corporate
 * policies) and a search bar has no business crashing over that — it just
 * stops remembering.
 */

export { MAX_RECENT_SEARCHES, pushRecentSearch } from "@upkeep/domain";
import { pushRecentSearch } from "@upkeep/domain";

const STORAGE_KEY = "project-upkeep-recent-searches";

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
