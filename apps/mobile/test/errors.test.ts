/**
 * Tests for src/errors.ts -- the one place a raw error becomes words a person
 * can read, and the one door a swallowed error is reported through. The Sentry
 * wrapper behind `reportError` is replaced by a recorder (helpers/fake-backend.ts).
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import { reported } from './helpers/fake-backend';
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, friendlyDbMessage, reportError } from '../src/errors';

afterEach(() => { mock.restoreAll(); reported.length = 0; });

test('friendlyDbMessage translates the trigger and RPC messages a person would otherwise see raw', () => {
  assert.match(friendlyDbMessage('location must belong to owner_user_id of the card'), /no longer yours/);
  assert.match(friendlyDbMessage('source row no longer matches what was decided'), /changed since you picked it/);
  assert.match(friendlyDbMessage('stack no longer matches the decided target'), /changed while this was in flight/);
});

test('friendlyDbMessage leaves any other message alone', () => {
  assert.equal(friendlyDbMessage('Something specific'), 'Something specific');
});

test('errorMessage reads an Error, or any object with a message, and translates it', () => {
  assert.equal(errorMessage(new Error('plain')), 'plain');
  assert.equal(errorMessage({ message: 'from a supabase error object' }), 'from a supabase error object');
  assert.match(errorMessage(new Error('stack no longer matches the decided target')), /try again/);
});

test('errorMessage falls back to a retry line for anything else', () => {
  for (const odd of [undefined, null, 'a bare string', 42, {}]) assert.equal(errorMessage(odd), 'Something went wrong. Please retry.');
});

test('reportError warns with the context and forwards the error to crash reporting', () => {
  const warn = mock.method(console, 'warn', () => {});
  const err = new Error('boom');
  reportError(err, 'catalog.load');
  assert.deepEqual(warn.mock.calls[0]!.arguments, ['[catalog.load]', 'boom']);
  assert.deepEqual(reported, [{ error: err, context: 'catalog.load' }]);
});

test('reportError stringifies a non-Error', () => {
  const warn = mock.method(console, 'warn', () => {});
  reportError({ code: 7 }, 'ctx');
  assert.equal(warn.mock.calls[0]!.arguments[1], '[object Object]');
  reportError(undefined, 'ctx');
  assert.equal(warn.mock.calls[1]!.arguments[1], 'undefined');
});
