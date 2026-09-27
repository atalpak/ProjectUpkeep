import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest } from '../src/lib/auth/request-auth';

const cookie = { kind: 'cookie' };
test('web requests validate the cookie client', async () => {
  assert.equal(await authenticateRequest(null, async () => cookie, () => { throw Error('bearer'); }, async c => c === cookie), cookie);
});
test('bearer validation uses the same client returned for RLS queries', async () => {
  const bearer = { kind: 'bearer' };
  assert.equal(await authenticateRequest('Bearer native-token', async () => { throw Error('cookie fallback'); }, token => {
    assert.equal(token, 'native-token'); return bearer;
  }, async (client, token) => { assert.equal(client, bearer); assert.equal(token, 'native-token'); return true; }), bearer);
});
test('malformed and rejected authorization never falls back to cookies', async () => {
  for (const header of ['', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer invalid']) {
    assert.equal(await authenticateRequest(header, async () => { throw Error('cookie fallback'); }, () => cookie, async () => false), null);
  }
});
test('anonymous cookie requests are rejected', async () => {
  assert.equal(await authenticateRequest(null, async () => cookie, () => cookie, async () => false), null);
});
