import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardIndex, quickMatch, QUICK_MIN_SCORE, QUICK_AMBIGUITY_MARGIN, type Candidate } from '../src';
import { parseCases, toEvidence, scoreCases, classify, tally, sweep, bandSummary } from '../src/accuracy';

const load = (f: string) => JSON.parse(readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url), 'utf8'));
const index = new CardIndex(load('accuracy-sample-catalog.json'));
const cases = parseCases(load('accuracy-sample-reads.json'));
const { scored, missing } = scoreCases(index, cases);
const shipped = { minScore: QUICK_MIN_SCORE, ambiguityMargin: QUICK_AMBIGUITY_MARGIN };
const byLabel = (needle: string) => scored.find(s => s.case.label.includes(needle))!;

test('sample fixture: every expectedId exists in the sample catalog', () => {
  assert.deepEqual(missing, []);
  assert.equal(scored.length, cases.length);
});

test('toEvidence: shorthand becomes lines and a "SET NUMBER" printing line; raw lines win', () => {
  assert.deepEqual(toEvidence({ label: 'x', expectedId: null, name: 'Sol Ring', setCode: 'C21', collectorNumber: '263' }), { lines: ['Sol Ring'], printingLines: ['C21 263'] });
  assert.deepEqual(toEvidence({ label: 'x', expectedId: null, lines: ['a', 'b'], printingLines: ['0718', 'FDN'] }), { lines: ['a', 'b'], printingLines: ['0718', 'FDN'] });
  assert.deepEqual(toEvidence({ label: 'x', expectedId: null, name: 'Sol Ring' }).printingLines, []);
});

test('parseCases: rejects malformed fixtures with the case named', () => {
  assert.throws(() => parseCases({}), /"cases" array/);
  assert.throws(() => parseCases({ cases: [{ label: 'a', expectedId: 5, name: 'x' }] }), /case 0 \(a\).*expectedId/);
  assert.throws(() => parseCases({ cases: [{ label: 'a', expectedId: null }] }), /needs lines or name/);
});

test('scoreCases: an id the catalog lacks is reported, not counted wrong', () => {
  const r = scoreCases(index, [{ label: 'ghost', expectedId: '11111111-1111-4111-8111-111111111111', name: 'Sol Ring' }]);
  assert.deepEqual(r.missing, ['ghost']);
  assert.equal(r.scored.length, 0);
});

test('classify: exact, right-card-wrong-printing, wrong card and abstained are told apart', () => {
  assert.equal(classify(byLabel('clean read, set+number on one line'), shipped).outcome, 'exact');
  // Modern split footer: hints are not found, so it is a name-only tie and cannot be trusted with the printing.
  const split = classify(byLabel('modern footer split'), shipped);
  assert.notEqual(split.outcome, 'exact');
  assert.equal(split.pinnedWrong, false);
  // Force a wrong card and a wrong printing by relabelling the expected id.
  const solRing = byLabel('Sol Ring, clean');
  const otherCard = { ...solRing, expectedOracleId: index.get(byLabel('Serra Angel, clean').case.expectedId!)!.oracleId, case: { ...solRing.case, expectedId: byLabel('Serra Angel, clean').case.expectedId } };
  assert.equal(classify(otherCard, shipped).outcome, 'wrong-card');
  const otherPrinting = { ...solRing, case: { ...solRing.case, expectedId: byLabel('Sol Ring, three').case.expectedId } };
  const wp = classify(otherPrinting, shipped);
  assert.equal(wp.outcome, 'wrong-printing');
  assert.equal(wp.pinnedWrong, true, 'set+number matched a printing that was not the labelled one');
  assert.equal(classify(byLabel('unreadable frame'), shipped).outcome, 'abstained');
});

test('tally: "no card" reads count as false accepts, not as wrong cards', () => {
  const t = tally(scored, shipped);
  assert.equal(t.noCardTotal, 3);
  assert.equal(t.total, cases.length - 3);
  assert.equal(t.exact + t.wrongPrinting + t.wrongCard + t.abstained, t.total);
  // A cutoff of 1.01 accepts nothing.
  const none = tally(scored, { minScore: 1.01, ambiguityMargin: 0 });
  assert.equal(none.abstained, none.total);
  assert.equal(none.falseAccepts, 0);
});

test('sweep: raising minScore never accepts more reads', () => {
  const rows = sweep(scored, [0.5, 0.7, 0.9, 1], [0.05]);
  const accepted = rows.map(r => r.tally.total - r.tally.abstained);
  for (let i = 1; i < accepted.length; i++) assert.ok(accepted[i]! <= accepted[i - 1]!);
  assert.equal(rows.length, 4);
});

test('sweep at the shipped cutoffs agrees with quickMatch called directly', () => {
  let exact = 0;
  for (const s of scored) {
    if (s.case.expectedId === null) continue;
    const m = quickMatch(s.candidates);
    if (m.ok && m.printing.id === s.case.expectedId) exact++;
  }
  assert.equal(tally(scored, shipped).exact, exact);
});

test('quickMatch: explicit limits override the defaults', () => {
  const mk = (score: number, oracleId: string): Candidate => ({ printing: { ...index.bundle.printings[0]!, oracleId }, score, evidence: 'name' });
  const a = '55555555-5555-4555-8555-555555555555', b = '66666666-6666-4666-8666-666666666666';
  assert.equal(quickMatch([mk(0.9, a)]).ok, true);
  assert.equal(quickMatch([mk(0.9, a)], { minScore: 0.95, ambiguityMargin: 0.05 }).ok, false);
  assert.equal(quickMatch([mk(0.9, a), mk(0.86, b)], { minScore: 0.85, ambiguityMargin: 0.05 }).ok, false);
  assert.equal(quickMatch([mk(0.9, a), mk(0.86, b)], { minScore: 0.85, ambiguityMargin: 0.01 }).ok, true);
});

test('bandSummary: totals the labelled reads and leaves "no card" reads out', () => {
  const b = bandSummary(scored);
  assert.equal(b.confident.total + b.uncertain.total + b.none.total, cases.length - 3);
});
