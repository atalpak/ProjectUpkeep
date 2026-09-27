import { FakeBackend, eqValue, fail, ok, setBackend } from './helpers/fake-backend';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOTIFICATION_PREFERENCES, loadNotificationPreferences, saveNotificationPreference } from '../src/notificationPreferences';
test('missing preferences use enabled defaults and read is explicitly owner scoped', async () => {
  const fake = new FakeBackend(call => { assert.equal(call.table, 'notification_preferences'); assert.equal(eqValue(call, 'user_id'), 'u1'); return ok(null); });
  setBackend(fake); assert.deepEqual(await loadNotificationPreferences('u1'), DEFAULT_NOTIFICATION_PREFERENCES);
});
test('saved values are returned and only changed category is written', async () => {
  const value = { trade_offers: false, trade_updates: true, friendships: false };
  const fake = new FakeBackend(() => ok(value)); setBackend(fake);
  assert.deepEqual(await loadNotificationPreferences('u1'), value);
  await saveNotificationPreference('u1', 'trade_updates', false);
  const op = fake.calls[1]!.ops.find(o => o.method === 'upsert');
  assert.deepEqual(op?.args, [{ user_id: 'u1', trade_updates: false }, { onConflict: 'user_id', defaultToNull: false }]);
});
test('load and save failures do not pretend preferences were persisted', async () => {
  setBackend(new FakeBackend(() => fail('missing table')));
  await assert.rejects(loadNotificationPreferences('u1'), /Could not load/);
  await assert.rejects(saveNotificationPreference('u1', 'friendships', false), /previous setting/);
});
