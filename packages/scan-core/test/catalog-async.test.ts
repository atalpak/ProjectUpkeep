import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, type CatalogBundle } from '../src';
const bundle: CatalogBundle = {
  schemaVersion: 1, version: 'async-test', generatedAt: '2026-09-26T00:00:00Z',
  printings: Array.from({ length: 2001 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    oracleId: `10000000-0000-4000-8000-${String(i % 3).padStart(12, '0')}`,
    name: `Arcane Guardian ${i % 3}`, aliases: i === 0 ? ['Éclair', '稲妻'] : [],
    setCode: 'tst', collectorNumber: String(i), finishes: ['nonfoil'], language: 'en',
  })),
};
test('async construction yields before completion and preserves every lookup', async () => {
  const sync = new CardIndex(bundle);
  let yields = 0;
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const work = CardIndex.createAsync(bundle, async () => { if (++yields === 1) await paused; }).then(index => { settled = true; return index; });
  await Promise.resolve();
  assert.ok(yields > 0); assert.equal(settled, false);
  release();
  const asyncIndex = await work;
  assert.ok(yields >= 4);
  for (const query of ['Arcane Guardian 0', 'Arcane Guardlan 1', 'Éclair', '稲妻']) assert.deepEqual(asyncIndex.searchWithTotal(query), sync.searchWithTotal(query));
  assert.deepEqual(asyncIndex.byFooter('TST', '0001'), sync.byFooter('TST', '0001'));
  assert.deepEqual(asyncIndex.printingsOf(bundle.printings[0]!.oracleId), sync.printingsOf(bundle.printings[0]!.oracleId));
  assert.deepEqual(asyncIndex.setCodes, sync.setCodes);
  for (const p of bundle.printings) assert.equal(asyncIndex.get(p.id), p);
});
test('async validation rejects corrupt and duplicate rows before publishing an index', async () => {
  await assert.rejects(CardIndex.createAsync({ ...bundle, schemaVersion: 2 }), /Invalid catalog/);
  await assert.rejects(CardIndex.createAsync({ ...bundle, printings: [...bundle.printings, bundle.printings[0]] }, async () => {}), /Invalid printing/);
  await assert.rejects(CardIndex.createAsync({ ...bundle, printings: [{ ...bundle.printings[0], imageUri: 'http://unsafe' }] }), /Invalid printing/);
});
