import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_MIN_MS, SCAN_STATUS_TEXT, SCAN_STATUSES, flushStatus, initialPacer, isScanStatus, paceStatus } from '../src';

test('every native status has coaching text, and only known statuses are accepted', () => {
  for (const s of SCAN_STATUSES) assert.ok(SCAN_STATUS_TEXT[s].length > 0);
  assert.equal(SCAN_STATUS_TEXT.searching, 'Hold a card up to the camera');
  assert.ok(isScanStatus('far') && !isScanStatus('nope') && !isScanStatus(undefined));
});

test('a change after the minimum hold shows at once; one inside it waits out the hold', () => {
  const first = paceStatus(initialPacer(0), 'far', 500);
  assert.equal(first.state.shown, 'far');
  assert.equal(first.waitMs, null);
  const soon = paceStatus(first.state, 'moving', 500 + 100);
  assert.equal(soon.state.shown, 'far', 'not replaced inside the hold');
  assert.equal(soon.waitMs, STATUS_MIN_MS - 100);
  const after = flushStatus(soon.state, 500 + STATUS_MIN_MS);
  assert.equal(after.state.shown, 'moving');
  assert.equal(after.waitMs, null);
});

test('flicker between two states shows neither change: returning to the shown state cancels the queue', () => {
  const shown = paceStatus(initialPacer(0), 'far', 1000).state;
  const away = paceStatus(shown, 'searching', 1050);
  assert.equal(away.state.queued, 'searching');
  const back = paceStatus(away.state, 'far', 1100);
  assert.equal(back.state.queued, null);
  assert.equal(back.state.shown, 'far');
});

test('inside one hold the more actionable message wins, and the text still ends on the truth', () => {
  const shown = paceStatus(initialPacer(0), 'far', 1000).state;
  const a = paceStatus(shown, 'moving', 1050);
  const b = paceStatus(a.state, 'searching', 1100);
  assert.equal(b.state.queued, 'moving', 'searching is less actionable than the queued moving');
  const flushed = flushStatus(b.state, 1400);
  assert.equal(flushed.state.shown, 'moving');
  assert.equal(flushed.state.queued, 'searching', 'native has since gone back to searching: reach it after one more hold');
  assert.equal(flushed.waitMs, STATUS_MIN_MS);
  const end = flushStatus(flushed.state, 1800);
  assert.equal(end.state.shown, 'searching');
  assert.equal(end.waitMs, null);
});

test('reading is never held back', () => {
  const shown = paceStatus(initialPacer(0), 'blurry', 1000).state;
  const reading = paceStatus(shown, 'reading', 1010);
  assert.equal(reading.state.shown, 'reading');
  assert.equal(reading.waitMs, null);
});

test('an event for the shown state changes nothing and schedules nothing', () => {
  const step = paceStatus(initialPacer(0), 'searching', 10);
  assert.equal(step.state.shown, 'searching');
  assert.equal(step.waitMs, null);
});
