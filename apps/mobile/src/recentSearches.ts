import * as SecureStore from 'expo-secure-store';
import { pushRecentSearch } from '@upkeep/domain';

// Recent card searches -- the phone twin of the web header search's
// localStorage list (src/lib/search/recent-searches.ts). The list rule itself
// (pushRecentSearch, dedup + cap, most recent first) is shared from
// @upkeep/domain; only the storage differs, because SecureStore's API is
// async where localStorage's is sync, and because this is a per-device
// convenience, not account data -- it is deliberately not cleared on sign-out
// the way a pending scan or pending move is (storage.ts): what you searched
// for is not sensitive, and staying handy across accounts on a shared device
// is more useful than surprising.
const KEY = 'upkeep.recent-searches.v1';

export async function readRecentSearches(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function recordRecentSearch(term: string): Promise<string[]> {
  const next = pushRecentSearch(await readRecentSearches(), term);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable or full -- the search itself still worked, it
    // just will not be remembered next time.
  }
  return next;
}
