import { authTest } from './helpers/auth-stubs';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword } from '../src/auth';
const input = { current: 'current-password', password: 'new-password', confirm: 'new-password' };
afterEach(() => { authTest.calls.length = 0; authTest.reauthError = null; authTest.updateError = null; authTest.reauthId = 'u1'; authTest.user.id = 'u1'; authTest.onReauth = null; });
test('validation rejects short/mismatched passwords before reauthentication', async () => {
  assert.equal((await changePassword('u1', { ...input, password: 'short' })).ok, false);
  assert.equal((await changePassword('u1', { ...input, confirm: 'different' })).ok, false);
  assert.equal((await changePassword('u1', { ...input, current: '' })).ok, false);
  assert.deepEqual(authTest.calls, []);
});
test('wrong current password and rate limits never reach updateUser', async () => {
  authTest.reauthError = { status: 400, message: 'Invalid credentials' };
  assert.deepEqual(await changePassword('u1', input), { ok: false, error: "That current password isn't right." });
  authTest.reauthError = { status: 429, message: 'Too many requests' };
  assert.match(JSON.stringify(await changePassword('u1', input)), /wait a minute/);
  assert.ok(authTest.calls.every(call => call.kind === 'reauth'));
});
test('reauthentication uses account email; successful update uses only the new password', async () => {
  assert.deepEqual(await changePassword('u1', input), { ok: true, notice: 'Password changed.' });
  assert.deepEqual(authTest.calls, [{ kind: 'reauth', value: { email: 'one@example.com', password: 'current-password' } }, { kind: 'update', value: { password: 'new-password' } }]);
});
test('wrong account cannot change a password; mismatched reauthentication refuses update', async () => {
  assert.equal((await changePassword('u2', input)).ok, false); assert.deepEqual(authTest.calls, []);
  authTest.reauthId = 'u2';
  assert.equal((await changePassword('u1', input)).ok, false); assert.equal(authTest.calls.length, 1);
});
test('network verification failures and update failures are visible', async () => {
  authTest.reauthError = { status: 0, message: 'fetch failed' };
  assert.match(JSON.stringify(await changePassword('u1', input)), /connection/);
  authTest.reauthError = null; authTest.updateError = { message: 'Password update failed' };
  assert.deepEqual(await changePassword('u1', input), { ok: false, error: 'Password update failed' });
});
test('switching the main account during reauthentication refuses the password update', async () => {
  authTest.onReauth = () => { authTest.user.id = 'u2'; };
  assert.equal((await changePassword('u1', input)).ok, false);
  assert.deepEqual(authTest.calls.map(call => call.kind), ['reauth']);
});
