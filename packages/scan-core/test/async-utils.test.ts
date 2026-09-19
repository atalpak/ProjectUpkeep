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

test('LruCache rejects a nonsense capacity', () => {
  assert.throws(() => new LruCache(0));
});
