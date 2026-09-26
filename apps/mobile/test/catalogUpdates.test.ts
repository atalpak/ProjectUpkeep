/**
 * Tests for src/catalogUpdates.ts -- "is there a newer card database?".
 *
 * The rules that matter: only ever offer something genuinely newer, ask at most
 * once a day, never nag about a version the person said "Later" to, and never
 * show an error for a check that could not be made. SecureStore (where the
 * last-checked record lives) is an in-memory fake; `fetch` is stubbed.
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import './helpers/clock'; // checkedAt is Date.now(); a fake clock makes "a day later" instant
import { tick } from './helpers/clock';
import { secureStore as store } from './helpers/fake-secure-store';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, dismissUpdate, fetchLatest, isNewer, latestUrl } from '../src/catalogUpdates';

const DAY = 24 * 60 * 60 * 1000;
const POINTER_URL = 'https://cdn.example/catalog/v1/latest.json';
const pointer = (over: Record<string, unknown> = {}) => ({ version: 'v2', generatedAt: '2026-09-19T00:00:00Z', url: 'https://cdn.example/catalog/v1/catalog-abc.json', bytes: 40_000_000, ...over });
const current = { generatedAt: '2026-09-01T00:00:00Z' };

const realFetch = globalThis.fetch;
let fetches: string[] = [];
const serve = (respond: () => { ok: boolean; body?: unknown } | Error) => {
  fetches = [];
  globalThis.fetch = (async (input: unknown) => {
    fetches.push(String(input));
    const r = respond();
    if (r instanceof Error) throw r;
    return { ok: r.ok, json: async () => r.body } as unknown as Response;
  }) as typeof fetch;
};

beforeEach(() => {
  store.clear();
  process.env.EXPO_PUBLIC_CATALOG_URL = 'https://cdn.example/catalog/v1/catalog-abc.json';
  tick(2 * DAY); // every test starts with the last check long ago
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.EXPO_PUBLIC_CATALOG_URL; });

test('latestUrl swaps the hashed file name for latest.json, and is null without an https catalog url', () => {
  assert.equal(latestUrl(), POINTER_URL);
  process.env.EXPO_PUBLIC_CATALOG_URL = 'http://insecure.example/catalog-abc.json';
  assert.equal(latestUrl(), null);
  process.env.EXPO_PUBLIC_CATALOG_URL = '';
  assert.equal(latestUrl(), null);
  delete process.env.EXPO_PUBLIC_CATALOG_URL;
  assert.equal(latestUrl(), null);
});

test('isNewer compares by generation time, not by string, and an unreadable date is never "newer"', () => {
  const at = (generatedAt: string) => ({ ...pointer(), generatedAt });
  assert.equal(isNewer(at('2026-09-19T00:00:00Z'), current), true);
  assert.equal(isNewer(at('2026-09-01T00:00:00Z'), current), false); // same moment
  assert.equal(isNewer(at('2026-08-01T00:00:00Z'), current), false);
  assert.equal(isNewer(at('2026-09-19T00:00:00+02:00'), { generatedAt: '2026-09-19T00:00:00Z' }), false); // earlier in UTC although the string sorts later
  assert.equal(isNewer(at('not a date'), current), false);
  assert.equal(isNewer(at('2026-09-19T00:00:00Z'), { generatedAt: 'demo' }), false);
});

test('fetchLatest reads the pointer, defaulting a missing size to 0', async () => {
  serve(() => ({ ok: true, body: pointer({ bytes: undefined }) }));
  assert.deepEqual(await fetchLatest(), { version: 'v2', generatedAt: '2026-09-19T00:00:00Z', url: 'https://cdn.example/catalog/v1/catalog-abc.json', bytes: 0 });
  assert.deepEqual(fetches, [POINTER_URL]);
});

test('fetchLatest is null, never an error, for offline, a missing pointer, or a malformed or non-https one', async () => {
  serve(() => new Error('offline'));
  assert.equal(await fetchLatest(), null);
  serve(() => ({ ok: false }));
  assert.equal(await fetchLatest(), null);
  serve(() => ({ ok: true, body: pointer({ version: 2 }) }));
  assert.equal(await fetchLatest(), null);
  serve(() => ({ ok: true, body: pointer({ url: 'http://cdn.example/catalog.json' }) }));
  assert.equal(await fetchLatest(), null);
  delete process.env.EXPO_PUBLIC_CATALOG_URL;
  serve(() => ({ ok: true, body: pointer() }));
  assert.equal(await fetchLatest(), null);
  assert.deepEqual(fetches, []); // and with nothing configured it does not even ask
});

test('checkForUpdate offers a newer catalog', async () => {
  serve(() => ({ ok: true, body: pointer() }));
  const r = await checkForUpdate(current);
  assert.equal(r.status, 'available');
  assert.equal(r.status === 'available' && r.latest.version, 'v2');
});

test('checkForUpdate says current when the phone already has it, and unknown when it could not tell', async () => {
  serve(() => ({ ok: true, body: pointer({ generatedAt: current.generatedAt }) }));
  assert.deepEqual(await checkForUpdate(current), { status: 'current' });
  serve(() => new Error('offline'));
  assert.deepEqual(await checkForUpdate(current, true), { status: 'unknown' });
});

test('the automatic check runs at most once a day', async () => {
  serve(() => ({ ok: true, body: pointer() }));
  assert.equal((await checkForUpdate(current)).status, 'available');
  tick(DAY - 1);
  assert.deepEqual(await checkForUpdate(current), { status: 'skipped' });
  assert.equal(fetches.length, 1);
  tick(1);
  assert.equal((await checkForUpdate(current)).status, 'available');
  assert.equal(fetches.length, 2);
});

test('a check that could not be made does not use up the day', async () => {
  serve(() => new Error('offline'));
  assert.equal((await checkForUpdate(current)).status, 'unknown');
  serve(() => ({ ok: true, body: pointer() }));
  assert.equal((await checkForUpdate(current)).status, 'available'); // straight away, not tomorrow
});

test('force (the Settings button) ignores the once-a-day limit', async () => {
  serve(() => ({ ok: true, body: pointer() }));
  await checkForUpdate(current);
  assert.equal((await checkForUpdate(current, true)).status, 'available');
  assert.equal(fetches.length, 2);
});

test('"Later" silences that version, but a newer one asks again, and force still shows it', async () => {
  serve(() => ({ ok: true, body: pointer() }));
  await dismissUpdate('v2');
  assert.deepEqual(await checkForUpdate(current), { status: 'skipped' });
  assert.equal((await checkForUpdate(current, true)).status, 'available');

  tick(DAY);
  serve(() => ({ ok: true, body: pointer({ version: 'v3', generatedAt: '2026-09-20T00:00:00Z' }) }));
  assert.equal((await checkForUpdate(current)).status, 'available');
});

test('a corrupt saved record is treated as never checked', async () => {
  store.set('upkeep.catalog-check.v1', '{not json');
  serve(() => ({ ok: true, body: pointer() }));
  assert.equal((await checkForUpdate(current)).status, 'available');
});
