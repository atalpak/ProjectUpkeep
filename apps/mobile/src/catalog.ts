import { File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { CardIndex, type CatalogBundle } from '@upkeep/scan-core';

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
export function loadCatalog(): CardIndex {
  const slots = [0,1].sort((a,b) => (slot(b).modificationTime ?? 0)-(slot(a).modificationTime ?? 0));
  for (const n of slots) {
    try { const index = new CardIndex(JSON.parse(slot(n).textSync())); activeSlot = n; return index; } catch { /* try the previous bundle */ }
  }
  return new CardIndex(demoBundle);
}
export async function refreshCatalog(): Promise<CardIndex> {
  const url = process.env.EXPO_PUBLIC_CATALOG_URL;
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
    let text = '', received = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rearm();
        received += chunk.value.byteLength;
        if (received > limit) { controller.abort(); throw new Error('Catalog exceeds the mobile budget.'); }
        text += decoder.decode(chunk.value, {stream:true});
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const index = new CardIndex(JSON.parse(text));
    const nextSlot = 1-activeSlot;
    slot(nextSlot).write(text);
    activeSlot = nextSlot;
    return index;
  } catch (e) {
    if (timedOut) throw new Error('The card database download stalled. Check your connection and try again. Your previous catalog is still available.');
    throw e;
  } finally { clearTimeout(stall); clearTimeout(ceiling); }
}
