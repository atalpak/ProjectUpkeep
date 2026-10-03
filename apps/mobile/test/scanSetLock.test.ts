import assert from 'node:assert/strict';
import test from 'node:test';
import { CardIndex, type Candidate, type Printing } from '@upkeep/scan-core';
import { candidatesInLockedSet } from '../src/scanSetLock';

const oracle = '00000000-0000-4000-8000-000000000001';
const printing = (suffix: string, setCode: string): Printing => ({
  id: `00000000-0000-4000-8000-${suffix}`,
  oracleId: oracle,
  name: 'Sample Card',
  aliases: [],
  setCode,
  collectorNumber: '1',
  finishes: ['nonfoil'],
  language: 'en',
});
const first = printing('000000000011', 'aaa');
const locked = printing('000000000012', 'bbb');
const index = new CardIndex({ schemaVersion: 1, version: 'test', generatedAt: '2026-01-01T00:00:00.000Z', printings: [first, locked] });

test('set lock maps a recognised card to the chosen set without inventing exact printing evidence', () => {
  const candidate: Candidate = { printing: first, score: 1, evidence: 'printing' };
  assert.deepEqual(candidatesInLockedSet([candidate], index, 'bbb'), [
    { printing: locked, score: 1, evidence: 'name' },
  ]);
  assert.deepEqual(candidatesInLockedSet([candidate], index, 'ccc'), []);
});

test('set lock retains a real exact printing match in the chosen set', () => {
  const candidate: Candidate = { printing: locked, score: 1, evidence: 'printing' };
  assert.deepEqual(candidatesInLockedSet([candidate], index, 'BBB'), [candidate]);
});
