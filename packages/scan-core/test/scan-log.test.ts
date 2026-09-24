import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAN_LOG_MAX, artSwitchNow, describeRanking, explainArt, explainGuess, formatScanLog, patchScanLog, printingHints, pushScanLog, rankPrintings,
  readScanLog, type Printing, type ScanLogEntry,
} from '../src';

const mk = (n: number, collectorNumber: string, releasedAt: string): Printing => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, oracleId: '00000000-0000-4000-8000-00000000f900', name: 'Book of Mazarbul', aliases: [],
  setCode: 'ltr', collectorNumber, finishes: ['nonfoil', 'foil'], language: 'en', imageUri: `https://img.example/${n}.jpg`, releasedAt, rarity: 'uncommon',
});
const a = mk(1, '116', '2023-06-23');
const b = mk(2, '567', '2023-11-03');
const sets = new Set(['ltr']);

const entry = (n: number, extra: Partial<ScanLogEntry> = {}): ScanLogEntry => ({
  id: `e${n}`, at: Date.UTC(2026, 8, 24, 12, 0, n), source: 'quick/outline', title: 'Book of Mazarbul', printingLines: ['LTR • EN'], hints: { setCode: 'LTR' },
  match: 'accepted', candidates: [], guess: null, artPlanned: null, ...extra,
});

test('explainGuess: says why, and names the newest-release default when the footer settles nothing', () => {
  const none = rankPrintings([a, b], printingHints(['LTR • EN'], sets));
  const g = explainGuess(none, printingHints(['LTR • EN'], sets));
  assert.equal(g.printing, null);
  assert.match(g.why, /no guess/);
  assert.match(g.why, /ltr #567/, 'the default it will pick is named');

  const hints = printingHints(['0116 U', 'LTR • EN'], sets);
  const exact = explainGuess(rankPrintings([a, b], hints), hints);
  assert.equal(exact.printing, 'ltr #116');
  assert.match(exact.why, /footer exact/);

  const only = explainGuess(rankPrintings([a], {}), {});
  assert.match(only.why, /only printing/);
});

test('describeRanking lists what each printing matched, best first', () => {
  const rows = describeRanking(rankPrintings([b, a], printingHints(['0116', 'LTR EN'], sets)));
  assert.equal(rows[0]!.printing, 'ltr #116');
  assert.match(rows[0]!.evidence, /set\+number.*weight 14|weight 14/);
  assert.match(rows[1]!.evidence, /matched set, weight 2/);
});

test('explainArt agrees with artSwitchNow about whether the picture may switch the selection', () => {
  const all = [a, b];
  const cases: Array<{ art: { ids: string[]; distances: number[] } | null; footerGuess: boolean; userPicked: boolean; adding: boolean }> = [
    { art: { ids: [a.id, b.id], distances: [0.1, 0.5] }, footerGuess: false, userPicked: false, adding: false },
    { art: { ids: [a.id, b.id], distances: [0.1, 0.5] }, footerGuess: true, userPicked: false, adding: false },
    { art: { ids: [a.id, b.id], distances: [0.3, 0.5] }, footerGuess: false, userPicked: false, adding: false },
    { art: { ids: [a.id, b.id], distances: [0.3, 0.5] }, footerGuess: true, userPicked: false, adding: false },
    { art: { ids: [a.id], distances: [0.1] }, footerGuess: false, userPicked: false, adding: false },
    { art: { ids: [a.id, b.id], distances: [0.1, 0.5] }, footerGuess: false, userPicked: true, adding: false },
    { art: { ids: [a.id, b.id], distances: [0.1, 0.5] }, footerGuess: false, userPicked: false, adding: true },
    { art: null, footerGuess: false, userPicked: false, adding: false },
  ];
  for (const c of cases) {
    const real = artSwitchNow({ name: 'Book of Mazarbul', artName: 'Book of Mazarbul', all, ...c });
    const said = explainArt({ all, ...c });
    assert.equal(said.applied, real !== null, JSON.stringify(c));
    if (real) assert.equal(said.winner, 'ltr #116');
  }
  const thin = explainArt({ all, art: { ids: [a.id, b.id], distances: [0.3, 0.5] }, footerGuess: true, userPicked: false, adding: false });
  assert.equal(thin.ratio, 0.6);
  assert.equal(thin.requiredRatio, 0.5);
  assert.match(thin.reason, /not decisive/);
});

test('the ring buffer keeps the newest SCAN_LOG_MAX reads and patches by id', () => {
  let log: ScanLogEntry[] = [];
  for (let i = 0; i < SCAN_LOG_MAX + 5; i++) log = pushScanLog(log, entry(i));
  assert.equal(log.length, SCAN_LOG_MAX);
  assert.equal(log[0]!.id, 'e5');
  assert.equal(patchScanLog(log, 'e6', { finalPrinting: 'ltr #116' })[1]!.finalPrinting, 'ltr #116');
  assert.deepEqual(patchScanLog(log, 'gone', { note: 'x' }), log, 'an entry that scrolled out is simply not patched');
});

test('readScanLog survives junk; formatScanLog is plain text, newest first', () => {
  assert.deepEqual(readScanLog(null), []);
  assert.deepEqual(readScanLog('not json'), []);
  assert.deepEqual(readScanLog('[1,{"id":"x"}]'), []);
  const log = [entry(1, { title: 'Old' }), entry(2, { title: 'New', guess: { printing: null, why: 'no guess: test' }, finalPrinting: 'ltr #567' })];
  assert.deepEqual(readScanLog(JSON.stringify(log)), log);
  const text = formatScanLog(log);
  assert.ok(text.indexOf('"New"') < text.indexOf('"Old"'));
  assert.match(text, /best guess: none -- no guess: test/);
  assert.match(text, /final printing: ltr #567/);
});
