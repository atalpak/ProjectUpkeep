import { setSearchToken } from './helpers/card-search-stubs';
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_ADVANCED_FILTER, type CatalogCard } from '@upkeep/domain';

import { mapSearchCard, mobileSearchQuery, searchCards } from '../src/cardSearch';
const card = { id: 'printing-1', name: 'Front // Back', layout: 'transform', digital: false, games: ['paper'], set: 'abc', collectorNumber: '12', imageNormal: null, imageSmall: null, faces: [{ imageNormal: 'front', imageSmall: 'small' }], scryfallUri: 'https://scryfall.com/card/abc/12' } as CatalogCard;
afterEach(() => { mock.restoreAll(); setSearchToken('mobile-token'); });
test('raw syntax reaches the service unchanged; facets use shared translation', () => {
  assert.equal(mobileSearchQuery('otag:ramp (c:r or c:g) unique:art', EMPTY_ADVANCED_FILTER), 'otag:ramp (c:r or c:g) unique:art');
  assert.equal(mobileSearchQuery('elf', { ...EMPTY_ADVANCED_FILTER, colors: ['R', 'G'], colorMode: 'any', cmc: { op: 'lte', value: 3 } }), 'elf mv<=3 (c:r or c:g)');
});
test('mixed colorless selections preserve any/at-most behavior', () => {
  assert.equal(mobileSearchQuery('', { ...EMPTY_ADVANCED_FILTER, colors: ['R', 'C'], colorMode: 'any' }), '(c:r or c:c)');
  assert.equal(mobileSearchQuery('', { ...EMPTY_ADVANCED_FILTER, colors: ['R', 'C'], colorMode: 'atMost' }), 'c<=r');
  assert.equal(mobileSearchQuery('', { ...EMPTY_ADVANCED_FILTER, colors: ['R'], colorMode: 'atMost' }), 'c<=r -c:c');
});
test('face images and exact IDs survive; unknown and digital printings are view-only', () => {
  const mapped = mapSearchCard(card, ['printing-1']);
  assert.equal(mapped.image, 'front'); assert.equal(mapped.imageSmall, 'small'); assert.equal(mapped.sampleCardId, 'printing-1'); assert.equal(mapped.local, true);
  assert.equal(mapSearchCard(card, null).local, false);
  assert.equal(mapSearchCard({ ...card, digital: true }, ['printing-1']).local, false);
});
test('search authenticates, preserves syntax, and requests the numbered page', async () => {
  mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, options?: RequestInit) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://upkeep.example'); assert.equal(parsed.searchParams.get('q'), 'otag:ramp unique:prints'); assert.equal(parsed.searchParams.get('page'), '2');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer mobile-token');
    return Response.json({ status: 'ok', cards: [card, { ...card, id: 'printing-2' }], totalCards: 500, nextPage: 3, warnings: ['warning'], localPrintingIds: ['printing-1'] });
  });
  const result = await searchCards('otag:ramp unique:prints', 2);
  assert.equal(result.results.length, 2); assert.equal(result.nextPage, 3); assert.equal(result.total, 500); assert.deepEqual(result.warnings, ['warning']);
});
test('empty owned pages retain navigation without claiming an owned total', async () => {
  mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    assert.equal(new URL(String(url)).searchParams.get('owned_only'), 'true');
    return Response.json({ status: 'ok', cards: [], totalCards: 2000, nextPage: 2, warnings: [], localPrintingIds: [] });
  });
  const result = await searchCards('', 1, true);
  assert.equal(result.results.length, 0); assert.equal(result.nextPage, 2); assert.equal(result.total, null);
});
test('unauthenticated searches make no network call', async () => {
  setSearchToken(null); mock.method(globalThis, 'fetch', async () => { throw Error('must not fetch'); });
  assert.match((await searchCards('elf')).error!, /Sign in/);
});
test('upstream syntax errors and warnings are shown; transport failures are recoverable', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ status: 'error', message: 'Unknown keyword', warnings: ['bad term'] }, { status: 400 }));
  const result = await searchCards('bad:term'); assert.equal(result.error, 'Unknown keyword'); assert.deepEqual(result.warnings, ['bad term']);
  mock.restoreAll(); mock.method(globalThis, 'fetch', async () => { throw Error('offline'); });
  assert.match((await searchCards('elf')).error!, /connection/);
});
