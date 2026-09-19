/**
 * Tests for src/printingVerify.ts -- the background picture check behind quick
 * scan's printing guess.
 *
 * `compareScanToPrintings` "never throws" and "changes nothing on any failure":
 * an old build with no native ranking, a download that fails or comes back empty,
 * the comparison throwing or hanging, and the sheet closing part-way. Each is a
 * way the check must degrade to null (leave the selection alone) rather than
 * either crash or, worse, hand back a result for a subset of the printings.
 * The decision of whether a result is decisive (`artSwitchTarget`) is scan-core's
 * and is tested there; here we test what reaches it. The file system and the
 * native ranker are in-memory fakes (helpers/fake-fs.ts).
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import './helpers/clock'; // fake timers for the 10s deadline, installed before anything that could capture a real one
import { flush, tick } from './helpers/clock';
import { disk, vision } from './helpers/fake-fs';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Printing } from '@upkeep/scan-core';
import { compareScanToPrintings } from '../src/printingVerify';

const printings = (n: number): Printing[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, oracleId: 'o', name: 'Card', aliases: [], setCode: 'tst', collectorNumber: String(i + 1), finishes: ['nonfoil'], language: 'en', imageUri: `https://img/p${i}.jpg`,
}));

const cached = (id: string) => `file:///cache/printing-art/${id}.jpg`;
const always = () => true;

beforeEach(() => { disk.reset(); vision.reset(); });

test('an older build with no native ranking checks nothing and downloads nothing', async () => {
  vision.available = false;
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(3), always), null);
  assert.equal(disk.downloads.length, 0);
  assert.equal(vision.calls.length, 0);
});

test('fewer than two candidates is nothing to compare', async () => {
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(1), always), null);
  assert.equal(await compareScanToPrintings('file:///scan.jpg', [], always), null);
  assert.equal(disk.downloads.length, 0);
});

test('downloads every reference, ranks the scan against them, and returns the distances by printing id', async () => {
  vision.rank = async (_p, refs) => refs.map((_, i) => [0.9, 0.2, 0.5][i]!);
  const result = await compareScanToPrintings('file:///scan.jpg', printings(3), always);
  assert.deepEqual(result, { ids: ['p0', 'p1', 'p2'], distances: [0.9, 0.2, 0.5] });
  assert.deepEqual(vision.calls[0], { photo: 'file:///scan.jpg', refs: [cached('p0'), cached('p1'), cached('p2')] });
});

test('a finished download is stored under the printing id, with no half-written .part file left behind', async () => {
  await compareScanToPrintings('file:///scan.jpg', printings(2), always);
  const left = [...disk.files.keys()];
  assert.deepEqual(left.sort(), [cached('p0'), cached('p1')]);
  assert.equal(left.some(uri => uri.endsWith('.part')), false);
});

test('a reference already in the cache is not downloaded again', async () => {
  disk.files.set(cached('p1'), { size: 500, modificationTime: 1 });
  await compareScanToPrintings('file:///scan.jpg', printings(3), always);
  assert.deepEqual(disk.downloads, ['https://img/p0.jpg', 'https://img/p2.jpg']);
});

test('a zero-length cached file is treated as absent and fetched again', async () => {
  disk.files.set(cached('p0'), { size: 0, modificationTime: 1 });
  await compareScanToPrintings('file:///scan.jpg', printings(2), always);
  assert.ok(disk.downloads.includes('https://img/p0.jpg'));
});

test('a download that fails drops only that printing from the result and leaves nothing behind', async () => {
  disk.onDownload = async (url, dest) => {
    if (url.endsWith('p1.jpg')) throw new Error('404');
    disk.files.set(dest.uri, { size: 100, modificationTime: 1 });
    return dest;
  };
  const result = await compareScanToPrintings('file:///scan.jpg', printings(3), always);
  assert.deepEqual(result?.ids, ['p0', 'p2']); // scan-core's artCoversAll then refuses to switch on a subset
  assert.equal(disk.files.has(cached('p1')), false);
});

test('an empty download is never mistaken for a finished reference', async () => {
  disk.onDownload = async (url, dest) => {
    disk.files.set(dest.uri, { size: url.endsWith('p1.jpg') ? 0 : 100, modificationTime: 1 });
    return dest;
  };
  const result = await compareScanToPrintings('file:///scan.jpg', printings(3), always);
  assert.deepEqual(result?.ids, ['p0', 'p2']);
  assert.equal(disk.files.has(cached('p1')), false);
  assert.equal([...disk.files.keys()].some(uri => uri.endsWith('.part')), false);
});

test('when every download fails there is nothing to rank, and it is null', async () => {
  disk.onDownload = async () => { throw new Error('offline'); };
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(3), always), null);
  assert.equal(vision.calls.length, 0);
});

test('a distance the native side could not compute (-1) drops that printing rather than poisoning the rest', async () => {
  vision.rank = async () => [0.3, -1, 0.6];
  assert.deepEqual(await compareScanToPrintings('file:///scan.jpg', printings(3), always), { ids: ['p0', 'p2'], distances: [0.3, 0.6] });
});

test('the native comparison throwing, or declining, is null and never an exception', async () => {
  vision.rank = async () => { throw new Error('vision crashed'); };
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(2), always), null);
  vision.rank = async () => null;
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(2), always), null);
});

test('a sheet that is already closed spends no data at all', async () => {
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(6), () => false), null);
  assert.equal(disk.downloads.length, 0);
  assert.equal(vision.calls.length, 0);
});

test('closing the sheet during the first wave of downloads stops the queue instead of letting every download begin', async () => {
  let open = true;
  disk.onDownload = async (_url, dest) => {
    if (disk.downloads.length >= 4) open = false; // the four in flight are the pool; nothing more may start
    disk.files.set(dest.uri, { size: 100, modificationTime: 1 });
    return dest;
  };
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(12), () => open), null);
  assert.equal(disk.downloads.length, 4);
  assert.equal(vision.calls.length, 0);
});

test('closing the sheet after the last download skips the native comparison', async () => {
  let open = true;
  disk.onDownload = async (_url, dest) => {
    if (disk.downloads.length === 3) open = false;
    disk.files.set(dest.uri, { size: 100, modificationTime: 1 });
    return dest;
  };
  assert.equal(await compareScanToPrintings('file:///scan.jpg', printings(3), () => open), null);
  assert.equal(vision.calls.length, 0);
});

test('a comparison that hangs is dropped after 10 seconds', async () => {
  vision.rank = () => new Promise<number[]>(() => {});
  const pending = compareScanToPrintings('file:///scan.jpg', printings(2), always);
  await flush();
  tick(9_999);
  await flush();
  tick(1);
  assert.equal(await pending, null);
});

test('after the deadline the remaining downloads are abandoned, not started', async () => {
  const stalled: (() => void)[] = [];
  disk.onDownload = (_url, dest) => new Promise(resolve => {
    stalled.push(() => { disk.files.set(dest.uri, { size: 100, modificationTime: 1 }); resolve(dest); });
  });
  const pending = compareScanToPrintings('file:///scan.jpg', printings(10), always);
  await flush();
  assert.equal(disk.downloads.length, 4); // the pool is full and stuck
  tick(10_000);
  assert.equal(await pending, null);
  stalled.forEach(release => release()); // the slow network finally answers
  await flush();
  await flush();
  assert.equal(disk.downloads.length, 4); // and nothing further was queued behind it
});

test('the cache is pruned to the newest 200 files before a run, so it cannot grow for ever', async () => {
  for (let i = 0; i < 205; i++) disk.files.set(`file:///cache/printing-art/old-${i}.jpg`, { size: 10, modificationTime: i });
  const [a, b] = printings(2) as [Printing, Printing];
  disk.files.set(cached(a.id), { size: 10, modificationTime: 1_000 });
  disk.files.set(cached(b.id), { size: 10, modificationTime: 1_001 });
  // 207 files; the 7 oldest (old-0 .. old-6) go.
  await compareScanToPrintings('file:///scan.jpg', [a, b], always);
  assert.equal(disk.files.size, 200);
  assert.equal(disk.files.has('file:///cache/printing-art/old-0.jpg'), false);
  assert.equal(disk.files.has('file:///cache/printing-art/old-6.jpg'), false);
  assert.equal(disk.files.has('file:///cache/printing-art/old-7.jpg'), true);
  assert.equal(disk.files.has(cached(a.id)), true);
});
