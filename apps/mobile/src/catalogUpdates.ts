import * as SecureStore from 'expo-secure-store';

// "Is there a newer card database?" The nightly job publishes each catalog to
// a hashed file name and then rewrites one fixed pointer, `latest.json`, next
// to it (scripts/publish-catalog.ts). The app cannot guess the newest hashed
// name, but it can always ask that one address.

export type LatestCatalog = { version: string; generatedAt: string; url: string; bytes: number };

const CHECK_KEY = 'upkeep.catalog-check.v1';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/** `.../catalog/v1/catalog-<hash>.json` -> `.../catalog/v1/latest.json`. Null when no catalog URL is configured. */
export function latestUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_CATALOG_URL;
  if (!url || !url.startsWith('https://')) return null;
  return url.replace(/[^/]+$/, 'latest.json');
}

/** Reads the pointer. Null for "could not tell" (offline, no pointer published yet, malformed): never an error worth showing. */
export async function fetchLatest(): Promise<LatestCatalog | null> {
  const url = latestUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<LatestCatalog>;
    if (typeof body.version !== 'string' || typeof body.generatedAt !== 'string' || typeof body.url !== 'string' || !body.url.startsWith('https://')) return null;
    return { version: body.version, generatedAt: body.generatedAt, url: body.url, bytes: typeof body.bytes === 'number' ? body.bytes : 0 };
  } catch { return null; }
}

/** Newer by generation time, not by string: only ever offer an update that is genuinely later than what is on the phone. */
export function isNewer(latest: LatestCatalog, current: { generatedAt: string }): boolean {
  const a = Date.parse(latest.generatedAt);
  const b = Date.parse(current.generatedAt);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

type CheckRecord = { checkedAt: number; dismissedVersion: string | null };

async function readRecord(): Promise<CheckRecord> {
  try {
    const raw = await SecureStore.getItemAsync(CHECK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CheckRecord>;
      return { checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0, dismissedVersion: typeof parsed.dismissedVersion === 'string' ? parsed.dismissedVersion : null };
    }
  } catch { /* treat as never checked */ }
  return { checkedAt: 0, dismissedVersion: null };
}

async function writeRecord(record: CheckRecord): Promise<void> {
  try { await SecureStore.setItemAsync(CHECK_KEY, JSON.stringify(record)); } catch { /* best effort */ }
}

export type UpdateCheck = { status: 'available'; latest: LatestCatalog } | { status: 'current' } | { status: 'unknown' } | { status: 'skipped' };

/**
 * The automatic check: at most once a day, and never for a version the user
 * already said "Later" to. `force` (the Settings button) ignores both.
 */
export async function checkForUpdate(current: { generatedAt: string }, force = false): Promise<UpdateCheck> {
  const record = await readRecord();
  if (!force && Date.now() - record.checkedAt < CHECK_EVERY_MS) return { status: 'skipped' };
  const latest = await fetchLatest();
  if (!latest) return { status: 'unknown' };
  await writeRecord({ ...record, checkedAt: Date.now() });
  if (!isNewer(latest, current)) return { status: 'current' };
  if (!force && record.dismissedVersion === latest.version) return { status: 'skipped' };
  return { status: 'available', latest };
}

/** "Later": do not ask about this version again (a newer one will ask). */
export async function dismissUpdate(version: string): Promise<void> {
  const record = await readRecord();
  await writeRecord({ ...record, dismissedVersion: version });
}
