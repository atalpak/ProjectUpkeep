import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache, TimeoutError, rejectAfter } from '../src/async-utils';

test('rejectAfter passes a fast result through', async () => {
  assert.equal(await rejectAfter(Promise.resolve(7), 50), 7);
});

test('rejectAfter passes a rejection through unchanged', async () => {
  await assert.rejects(rejectAfter(Promise.reject(new Error('boom')), 50), /boom/);
});

test('rejectAfter rejects with TimeoutError when the work hangs', async () => {
  await assert.rejects(rejectAfter(new Promise<never>(() => {}), 20), (e: unknown) => e instanceof TimeoutError);
});

test('LruCache evicts the least recently used entry', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1); // a is now newest
  c.set('c', 3); // evicts b
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
  assert.equal(c.size, 2);
});

test('LruCache set on an existing key refreshes it without growing', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1); c.set('b', 2); c.set('a', 9); c.set('c', 3);
  assert.equal(c.get('a'), 9);
  assert.equal(c.get('b'), undefined);
});

test('LruCache drops an entry older than its ttl, and reading does not extend it', () => {
  let t = 1000;
  const c = new LruCache<string, number>(5, 100, () => t);
  c.set('a', 1);
  t = 1099;
  assert.equal(c.get('a'), 1); // a read inside the window
  t = 1100;
  assert.equal(c.get('a'), undefined); // age counts from set, so the read did not renew it
  assert.equal(c.size, 0);
  c.set('a', 2);
  assert.equal(c.get('a'), 2); // a fresh set starts a new window
});

test('LruCache rejects a nonsense ttl', () => {
  assert.throws(() => new LruCache(1, 0));
});

test('LruCache rejects a nonsense capacity', () => {
  assert.throws(() => new LruCache(0));
});
