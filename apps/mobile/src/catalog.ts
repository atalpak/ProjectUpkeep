import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { CardIndex, type CatalogBundle } from '@upkeep/scan-core';
import { reportError } from './errors';

// Synthetic records keep demo mode deterministic. These must NEVER reach Supabase.
const oracle = '00000000-0000-4000-8000-000000000001';
export const demoBundle: CatalogBundle = {
  schemaVersion: 1, version: 'demo-only', generatedAt: '2026-09-16T00:00:00Z',
  printings: [
    {id:'00000000-0000-4000-8000-000000000010',oracleId:oracle,name:'Lightning Bolt',aliases:[],setCode:'m11',collectorNumber:'146',finishes:['nonfoil','foil'],language:'en'},
    {id:'00000000-0000-4000-8000-000000000011',oracleId:oracle,name:'Lightning Bolt',aliases:[],setCode:'sta',collectorNumber:'42',finishes:['nonfoil','foil','etched'],language:'en'},
    {id:'00000000-0000-4000-8000-000000000012',oracleId:'00000000-0000-4000-8000-000000000002',name:'Sol Ring',aliases:[],setCode:'cmm',collectorNumber:'396',finishes:['nonfoil','foil'],language:'en'},
  ],
};
// Two slots preserve the last usable bundle even if the app dies halfway through a write.
const slot = (n: number) => new File(Paths.document, `upkeep-catalog-${n}.json`);
let activeSlot = 0;
/** Dev-only: the ~40 MB bundle is parsed on the JS thread and its cost on a real phone was unmeasured. */
function timeParse(what: string, started: number) {
  if (__DEV__) console.log(`[catalog] ${what}: parse took ${Date.now() - started} ms`);
}
export function loadCatalog(): CardIndex {
  const slots = [0,1].sort((a,b) => (slot(b).modificationTime ?? 0)-(slot(a).modificationTime ?? 0));
  for (const n of slots) {
    try {
      const started = Date.now();
      const index = new CardIndex(JSON.parse(slot(n).textSync()));
      timeParse('load', started);
      activeSlot = n;
      return index;
    } catch (e) {
      // Falls back to the other slot, but a corrupt bundle is a real failure worth a trail.
      reportError(e, 'catalog.load');
    }
  }
  return new CardIndex(demoBundle);
}
export type CatalogProgress =
  | { phase: 'downloading'; received: number; /** From content-length; null when the server did not say. */ total: number | null }
  | { phase: 'preparing' };

/** Downloads the catalog, reporting progress. Reports at most ~8 times a second: a 40 MB body arrives in hundreds of chunks. */
export async function refreshCatalog(onProgress?: (progress: CatalogProgress) => void, urlOverride?: string): Promise<CardIndex> {
  const url = urlOverride ?? process.env.EXPO_PUBLIC_CATALOG_URL;
  if (!url || !url.startsWith('https://')) throw new Error('Configure an HTTPS Upkeep catalog URL first.');
  const controller = new AbortController();
  // A flat 30s cap on the whole request would fail any download slower than ~1.3 MB/s
  // (the catalog is ~40 MB). Abort on a 30s STALL instead, re-armed by every chunk, and
  // keep a 10 minute ceiling so a connection that trickles forever still ends.
  const STALL_MS = 30_000;
  // Why we aborted, so a stall reads as "check your connection" rather than a bare AbortError.
  let timedOut = false;
  const timeout = () => { timedOut = true; controller.abort(); };
  let stall = setTimeout(timeout, STALL_MS);
  const rearm = () => { clearTimeout(stall); stall = setTimeout(timeout, STALL_MS); };
  const ceiling = setTimeout(timeout, 10 * 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Catalog download failed. Your previous catalog is still available.');
    // The published catalog is ~39.98 MB today, right at the old 40 MB ceiling: the next
    // sync that added a few sets would have failed every download. 80 MB leaves headroom.
    const limit = 80_000_000;
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Catalog exceeds the 80 MB mobile budget.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const declared = Number(response.headers.get('content-length'));
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    let text = '', received = 0, lastReport = 0;
    onProgress?.({ phase: 'downloading', received: 0, total });
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rearm();
        received += chunk.value.byteLength;
        if (received > limit) { controller.abort(); throw new Error('Catalog exceeds the mobile budget.'); }
        text += decoder.decode(chunk.value, {stream:true});
        const now = Date.now();
        if (onProgress && now - lastReport >= 120) { lastReport = now; onProgress({ phase: 'downloading', received, total }); }
      }
      onProgress?.({ phase: 'downloading', received, total });
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    // Parsing ~40 MB runs on the JS thread and freezes the UI for a moment;
    // say so first and give React a beat to paint it.
    onProgress?.({ phase: 'preparing' });
    await new Promise(resolve => setTimeout(resolve, 60));
    const parseStarted = Date.now();
    const index = new CardIndex(JSON.parse(text));
    timeParse('download', parseStarted);
    const nextSlot = 1-activeSlot;
    slot(nextSlot).write(text);
    activeSlot = nextSlot;
    return index;
  } catch (e) {
    if (timedOut) throw new Error('The card database download stalled. Check your connection and try again. Your previous catalog is still available.');
    throw e;
  } finally { clearTimeout(stall); clearTimeout(ceiling); }
}

/**
 * The card database shipped inside the app (apps/mobile/assets/catalog-snapshot.db,
 * written by `npm run catalog:snapshot` before a native build). Optional: the
 * `require` sits in a try because the file is git-ignored, and Metro treats a
 * require inside a try as an optional dependency, so an app built without a
 * snapshot still bundles and simply falls back to asking for the download.
 */
function bundledSnapshot(): number | null {
  try { return require('../assets/catalog-snapshot.db') as number; } catch { return null; }
}

/**
 * First launch: if there is no downloaded catalog yet, unpack the bundled one
 * into the same two-slot store a download uses, and return it. Resolves null
 * when this build carries no snapshot (or it is unreadable), in which case the
 * caller falls back to asking the user to download.
 *
 * Not called when a catalog already exists: the newest of the saved and
 * downloaded ones wins, and updates arrive through the update check.
 */
export async function installBundledCatalog(): Promise<CardIndex | null> {
  const module = bundledSnapshot();
  if (module === null) return null;
  try {
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    const text = await new File(uri).text();
    const parseStarted = Date.now();
    const index = new CardIndex(JSON.parse(text));
    timeParse('bundled', parseStarted);
    const nextSlot = 1 - activeSlot;
    slot(nextSlot).write(text);
    activeSlot = nextSlot;
    return index;
  } catch (e) {
    // Not shown to the user (they get the download ask instead), but leave a trail for whoever builds the app.
    reportError(e, 'catalog.installBundled');
    return null;
  }
}
