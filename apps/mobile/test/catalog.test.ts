import { catalogDisk, catalogReads, catalogErrors, gateReads } from './helpers/catalog-stubs';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { demoBundle, loadCatalog, prepareCatalog, refreshCatalog } from '../src/catalog';
const real = { ...demoBundle, version: 'real-test' };
const slot = (n: number) => `file:///document/upkeep-catalog-${n}.json`;
afterEach(() => { catalogDisk.clear(); catalogReads.length = 0; catalogErrors.length = 0; gateReads(null); });
test('saved catalog reads are asynchronous and newest-valid-slot wins', async () => {
  catalogDisk.set(slot(0), { text: JSON.stringify(real), modified: 1 });
  catalogDisk.set(slot(1), { text: JSON.stringify({ ...real, version: 'newer' }), modified: 2 });
  let release!: () => void;
  gateReads(new Promise<void>(resolve => { release = resolve; }));
  let done = false;
  const work = loadCatalog().then(index => { done = true; return index; });
  await Promise.resolve(); assert.equal(done, false); release();
  assert.equal((await work).bundle.version, 'newer'); assert.deepEqual(catalogReads, [slot(1)]);
});
test('corrupt newest catalog falls back to the valid older slot', async () => {
  catalogDisk.set(slot(1), { text: '{broken', modified: 2 });
  catalogDisk.set(slot(0), { text: JSON.stringify(real), modified: 1 });
  assert.equal((await loadCatalog()).bundle.version, 'real-test');
  assert.equal(catalogErrors.length, 1); assert.deepEqual(catalogReads, [slot(1), slot(0)]);
});
test('startup shares one deferred load and uses the bundled snapshot if local slots are absent', async () => {
  catalogDisk.set('file:///snapshot', { text: JSON.stringify(real), modified: 0 });
  const first = prepareCatalog(true); const second = prepareCatalog(true);
  assert.equal(first, second); assert.deepEqual(catalogReads, []);
  assert.equal((await first).bundle.version, 'real-test'); assert.equal((await second).bundle.version, 'real-test');
  assert.deepEqual(catalogReads, ['file:///snapshot']); assert.ok(catalogDisk.has(slot(0)) || catalogDisk.has(slot(1)));
});
test('missing or invalid bundled snapshot safely retains demo; a settled flight can reload', async () => {
  catalogDisk.set('file:///snapshot', { text: '{}', modified: 0 });
  assert.equal((await prepareCatalog(true)).bundle.version, 'demo-only');
  catalogDisk.set(slot(0), { text: JSON.stringify(real), modified: 1 });
  assert.equal((await prepareCatalog(true)).bundle.version, 'real-test');
});
test('failed download validation never overwrites the previous valid catalog', async () => {
  catalogDisk.set(slot(0), { text: JSON.stringify(real), modified: 1 });
  await loadCatalog();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ schemaVersion: 9 });
  try { await assert.rejects(refreshCatalog(undefined, 'https://catalog.example'), /Invalid catalog/); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal((await loadCatalog()).bundle.version, 'real-test'); assert.equal(catalogDisk.has(slot(1)), false);
});
