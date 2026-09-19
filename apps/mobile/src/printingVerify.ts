import { Directory, File, Paths } from 'expo-file-system';
import { usableArt, withTimeout, type ArtResult, type Printing } from '@upkeep/scan-core';
import { cardImageRankingAvailable, rankCardImage } from '@upkeep/vision';

/**
 * The background half of quick scan's printing check. The footer picks the
 * printing the details page opens on, instantly (`bestGuessPrinting` in
 * scan-core); this compares the scanned card's picture with each candidate's
 * AFTER the page is open, and CardDetails may quietly switch the selection if
 * `artSwitchTarget` (pure, tested) says the result is confident and covers every
 * printing. Owner decision 2026-09-19: no blocking check and no "which printing?"
 * question, because both made quick scan slow.
 *
 * This file only gathers the picture distances and guards every way that can
 * fail: an older native build (no `rankCardImage`), a reference that will not
 * download, the comparison throwing, taking too long, or the sheet closing
 * (`stillWanted`, checked before each download and before the comparison so a
 * dismissed sheet stops spending the person's data). Downloads run a few at a
 * time and each checks `stillWanted` immediately before it starts, so closing
 * the sheet stops the queue at once instead of letting every download begin.
 * Each failure resolves to null, which changes nothing on screen.
 */

/** References are cached by printing id: a card scanned twice, or two scans of one card's reprints, download once. */
const cacheDir = () => new Directory(Paths.cache, 'printing-art');
/** Newest files kept in the cache; older ones are pruned on each run so it cannot grow for ever. */
const CACHE_KEEP = 200;
/** Downloads plus the native comparison get this long in the background; later than that the result is dropped. */
const VERIFY_TIMEOUT_MS = 10000;
/** Downloads in flight at once: enough to be quick, few enough that closing the sheet cancels most of them. */
const DOWNLOAD_CONCURRENCY = 4;

function pruneCache(dir: Directory) {
  try {
    const files = dir.list().filter((x): x is File => x instanceof File);
    if (files.length <= CACHE_KEEP) return;
    const stamp = (f: File) => f.modificationTime ?? 0;
    files.sort((a, b) => stamp(b) - stamp(a)).slice(CACHE_KEEP).forEach(f => { try { f.delete(); } catch { /* best effort */ } });
  } catch { /* a cache that cannot be pruned is still a cache */ }
}

/**
 * Downloads to a temporary name and moves into place only on success, so a
 * truncated or failed download is never mistaken for a finished reference.
 */
async function localReference(printing: Printing): Promise<string | null> {
  const dir = cacheDir();
  const temp = new File(dir, `${printing.id}.${Math.random().toString(36).slice(2)}.part`);
  try {
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
    const file = new File(dir, `${printing.id}.jpg`);
    if (file.exists && file.size > 0) return file.uri;
    const got = await File.downloadFileAsync(printing.imageUri!, temp, { idempotent: true });
    if (!got.exists || got.size <= 0) throw new Error('empty download');
    if (file.exists) file.delete();
    got.move(file);
    return file.uri;
  } catch {
    try { if (temp.exists) temp.delete(); } catch { /* nothing to clean */ }
    return null;
  }
}

async function artFor(photoUri: string, candidates: Printing[], stillWanted: () => boolean, expired: () => boolean): Promise<ArtResult | null> {
  const wanted = () => stillWanted() && !expired();
  const refs: Array<string | null> = candidates.map(() => null);
  let next = 0;
  // A small pool of workers pulling from one queue; each re-checks before it fetches.
  const worker = async () => {
    while (wanted()) {
      const i = next++;
      if (i >= candidates.length) return;
      refs[i] = await localReference(candidates[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, candidates.length) }, worker));
  if (!wanted()) return null;
  const usable = candidates.map((p, i) => ({ p, uri: refs[i]! })).filter((x): x is { p: Printing; uri: string } => x.uri !== null);
  if (usable.length === 0) return null;
  const distances = await rankCardImage(photoUri, usable.map(x => x.uri));
  if (!distances) return null;
  return usableArt(usable.map(x => x.p.id), distances);
}

/** Picture distances from the scanned card to each candidate, or null if they could not be had. Never throws. */
export async function compareScanToPrintings(photoUri: string, candidates: Printing[], stillWanted: () => boolean): Promise<ArtResult | null> {
  if (!cardImageRankingAvailable || candidates.length < 2) return null;
  try { pruneCache(cacheDir()); } catch { /* see pruneCache */ }
  // Once the timeout has dropped the result, the remaining downloads are pointless: `expired` stops the queue.
  let timedOut = false;
  const work = artFor(photoUri, candidates, stillWanted, () => timedOut).catch(() => null);
  const result = await withTimeout(work, VERIFY_TIMEOUT_MS, null);
  timedOut = true;
  return result;
}
