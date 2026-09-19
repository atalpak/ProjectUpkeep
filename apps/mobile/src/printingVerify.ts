import { Directory, File, Paths } from 'expo-file-system';
import {
  artShortlist, decidePrinting, printingHints, rankPrintings, usableArt, withTimeout,
  type ArtResult, type CardIndex, type Printing, type PrintingDecision,
} from '@upkeep/scan-core';
import { cardImageRankingAvailable, rankCardImage } from '@upkeep/vision';

/**
 * Quick scan's "which printing is it?" step. The name says which CARD; this
 * settles which PRINTING, because quick scan is used mostly for rare and
 * alternate-art cards where the wrong printing is the whole failure. It costs a
 * second or two (downloading the candidates' pictures, then one native
 * comparison), which the owner accepted in exchange for never guessing.
 *
 * The policy is `decidePrinting` in scan-core (pure, tested). This file only
 * gathers its inputs -- footer evidence from the read, and picture distances
 * from the native module -- and guards every way that can fail:
 *
 *  - an older native build (no `imageUri` on the read, or no `rankCardImage`),
 *  - a reference picture that will not download,
 *  - the comparison throwing.
 *
 * Each of those degrades to "no picture evidence". `decidePrinting` never pins
 * one of several printings on the picture alone (it needs an agreeing footer as
 * well, or provably identical artwork), so a failure here can only make the
 * person tap, never make the app guess. The picture's job is mostly to
 * pre-highlight the best guess in the picker.
 */

export interface VerifiedPrinting {
  decision: PrintingDecision;
  /** The photo of the card, for the picker to show beside the candidates. Null when the build did not produce one. */
  photoUri: string | null;
}

/** References are cached by printing id: a card scanned twice, or two scans of one card's reprints, download once. */
const cacheDir = () => new Directory(Paths.cache, 'printing-art');
/** Newest files kept in the cache; older ones are pruned on each run so it cannot grow for ever. */
const CACHE_KEEP = 200;
/** Downloads plus the native comparison must finish in this long, else the person is asked. */
const VERIFY_TIMEOUT_MS = 7000;

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

async function artFor(photoUri: string, candidates: Printing[]): Promise<ArtResult | null> {
  const refs = await Promise.all(candidates.map(localReference));
  const usable = candidates.map((p, i) => ({ p, uri: refs[i] })).filter((x): x is { p: Printing; uri: string } => x.uri !== null);
  if (usable.length === 0) return null;
  const distances = await rankCardImage(photoUri, usable.map(x => x.uri));
  if (!distances) return null;
  return usableArt(usable.map(x => x.p.id), distances);
}

/**
 * `printing` is the name-matched top candidate (any printing of the card);
 * `printingLines` are the footer OCR lines from the same read.
 */
export async function verifyPrinting(index: CardIndex, printing: Printing, printingLines: string[], photoUri: string | undefined): Promise<VerifiedPrinting> {
  const hints = printingHints(printingLines, index.setCodes);
  const ranking = rankPrintings(index.printingsOf(printing.oracleId), hints);
  // Nothing to compare when there is one printing; skip the downloads.
  if (ranking.printingConfidence === 'unique') return { decision: decidePrinting(ranking, null), photoUri: photoUri ?? null };

  let art: ArtResult | null = null;
  if (photoUri && cardImageRankingAvailable) {
    try { pruneCache(cacheDir()); } catch { /* see pruneCache */ }
    art = await withTimeout(artFor(photoUri, artShortlist(ranking.ranked)).catch(() => null), VERIFY_TIMEOUT_MS, null);
  }
  return { decision: decidePrinting(ranking, art), photoUri: photoUri ?? null };
}
