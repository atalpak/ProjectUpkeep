/**
 * Recent web searches — a per-browser convenience, so localStorage rather
 * than a table and a migration. The phone keeps its separate query-only
 * history in `apps/mobile/src/recentSearches.ts`.
 *
 * Storage is versioned because web recents now replay the complete search
 * options. Reads still accept the original string[] format as query-only
 * specs. localStorage can throw in locked-down browsers, so failures simply
 * disable remembering without affecting search.
 */

import { MAX_RECENT_SEARCHES, specFromParams, specToParams, type SearchSpec } from "@upkeep/domain";

export { MAX_RECENT_SEARCHES, pushRecentSearch } from "@upkeep/domain";

const STORAGE_KEY = "project-upkeep-recent-searches";
const STORAGE_VERSION = 2;

export type RecentSearchSpec = Omit<SearchSpec, "page">;

type RecentSearchEnvelope = {
  version: typeof STORAGE_VERSION;
  searches: RecentSearchSpec[];
};

/** Stable identity for a saved query and all its options; page is not history. */
export function recentSearchKey(spec: RecentSearchSpec): string {
  return specToParams({ ...spec, page: 1 }).toString();
}

/** Short human-readable values for the explicitly selected search options. */
export function recentSearchSummary(spec: RecentSearchSpec): string | null {
  const options: string[] = [];
  if (spec.unique) options.push(`unique ${spec.unique}`);
  if (spec.order) options.push(`order ${spec.order}`);
  if (spec.dir) options.push(spec.dir);
  if (spec.display) options.push(spec.display);
  if (spec.prefer) options.push(`prefer ${spec.prefer}`);
  if (spec.includeExtras !== undefined) options.push(`extras ${spec.includeExtras ? "on" : "off"}`);
  if (spec.includeMultilingual !== undefined) options.push(`multilingual ${spec.includeMultilingual ? "on" : "off"}`);
  if (spec.includeVariations !== undefined) options.push(`variations ${spec.includeVariations ? "on" : "off"}`);
  return options.length > 0 ? options.join(" · ") : null;
}

function toRecentSpec(value: unknown): RecentSearchSpec | null {
  if (typeof value === "string") {
    const q = value.trim();
    return q ? { q } : null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.q !== "string" || candidate.q.trim() === "") return null;

  // Reuse the URL contract to keep only supported options and leave the
  // query's interior text untouched. `page` is deliberately omitted.
  const params = new URLSearchParams();
  params.set("q", candidate.q.trim());
  for (const key of ["unique", "order", "dir", "display", "prefer"] as const) {
    if (typeof candidate[key] === "string") params.set(key, candidate[key]);
  }
  for (const key of ["include_extras", "include_multilingual", "include_variations"] as const) {
    const valueKey = {
      include_extras: "includeExtras",
      include_multilingual: "includeMultilingual",
      include_variations: "includeVariations",
    }[key];
    if (typeof candidate[valueKey] === "boolean") params.set(key, String(candidate[valueKey]));
  }

  const parsed = specFromParams(params);
  const { page, ...spec } = parsed;
  void page;
  return spec.q ? spec : null;
}

function cleanList(values: unknown[]): RecentSearchSpec[] {
  const unique: RecentSearchSpec[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const spec = toRecentSpec(value);
    if (!spec) continue;
    const key = recentSearchKey(spec);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(spec);
    if (unique.length === MAX_RECENT_SEARCHES) break;
  }
  return unique;
}

export function readRecentSearches(): RecentSearchSpec[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const migrated = cleanList(parsed);
      persistRecentSearches(migrated);
      return migrated;
    }
    if (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) &&
      (parsed as Partial<RecentSearchEnvelope>).version === STORAGE_VERSION &&
      Array.isArray((parsed as Partial<RecentSearchEnvelope>).searches)
    ) {
      return cleanList((parsed as RecentSearchEnvelope).searches);
    }
    return [];
  } catch {
    return [];
  }
}

export function recordRecentSearch(input: SearchSpec): RecentSearchSpec[] {
  const spec = toRecentSpec(input);
  if (!spec) return readRecentSearches();

  const next = cleanList([spec, ...readRecentSearches()]);
  persistRecentSearches(next);
  return next;
}

function persistRecentSearches(searches: RecentSearchSpec[]): void {
  try {
    const envelope: RecentSearchEnvelope = { version: STORAGE_VERSION, searches };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage is unavailable or full — the search itself still worked.
  }
}
