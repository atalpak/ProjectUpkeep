import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, ScanPipeline, artCandidates, bestGuessPrinting, printingHints, rankPrintings, regularFirst, type Printing } from '../src';

/**
 * Characterisation of the owner's 2026-09-24 phone test: quick scan opened the
 * right card on the WRONG printing (The Mouth of Sauron LTR #216 -> #667, Book of
 * Mazarbul LTR #116 -> #567, Oliphaunt #426 -> something else). The rows below
 * are the live catalog's (read 2026-09-23): each pair is the same rarity, both
 * nonfoil+foil, and differs only in number and RELEASE DATE -- the #5xx/#6xx
 * printings came out 2023-11-03, the base ones 2023-06-23.
 *
 * These tests pin what the code does today, so the diagnosis is reproducible:
 * they describe behaviour, they do not endorse it.
 */
const mk = (n: number, oracle: string, name: string, collectorNumber: string, releasedAt: string, rarity: string): Printing => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, oracleId: `00000000-0000-4000-8000-00000000f${oracle}`, name, aliases: [],
  setCode: 'ltr', collectorNumber, finishes: ['nonfoil', 'foil'], language: 'en', imageUri: `https://img.example/${n}.jpg`, releasedAt, rarity,
});
const mouth216 = mk(1, '001', 'The Mouth of Sauron', '216', '2023-06-23', 'uncommon');
const mouth667 = mk(2, '001', 'The Mouth of Sauron', '667', '2023-11-03', 'uncommon');
const book116 = mk(3, '002', 'Book of Mazarbul', '116', '2023-06-23', 'uncommon');
const book567 = mk(4, '002', 'Book of Mazarbul', '567', '2023-11-03', 'uncommon');
const oli139 = mk(5, '003', 'Oliphaunt', '139', '2023-06-23', 'common');
const oli426 = mk(6, '003', 'Oliphaunt', '426', '2023-06-23', 'common');
const oli590 = mk(7, '003', 'Oliphaunt', '590', '2023-11-03', 'common');
const bundle = { schemaVersion: 1 as const, version: 'ltr', generatedAt: '2026-09-23T00:00:00Z', printings: [mouth216, mouth667, book116, book567, oli139, oli426, oli590] };
const index = new CardIndex(bundle);
const guess = (name: string, footer: string[]) => {
  const printings = index.printingsOf(index.search(name)[0]!.printing.oracleId);
  const ranking = rankPrintings(printings, printingHints(footer, index.setCodes));
  return { ranking, guess: bestGuessPrinting(ranking), top: ranking.ranked[0]!.printing.collectorNumber };
};

test('a clean footer names the printing: 216 / 116 win even though 667 / 567 are newer', () => {
  assert.equal(guess('The Mouth of Sauron', ['0216/0281 U', 'LTR • EN']).guess?.collectorNumber, '216');
  assert.equal(guess('Book of Mazarbul', ['U 0116', 'LTR • EN']).guess?.collectorNumber, '116');
});

test('regularFirst prefers the NEWER release over the lower number, so the November printings are the "regular" ones', () => {
  assert.ok(regularFirst(mouth667, mouth216) < 0, '667 sorts before 216');
  assert.ok(regularFirst(book567, book116) < 0, '567 sorts before 116');
  assert.ok(regularFirst(oli590, oli139) < 0 && regularFirst(oli590, oli426) < 0, '590 is the default Oliphaunt');
});

test('when the footer gives NO usable evidence, the default is 667 / 567 -- exactly the reported wrong printings', () => {
  for (const footer of [[], ['~~ ,, ..'], ['LTR • EN']]) {
    const m = guess('The Mouth of Sauron', footer);
    assert.equal(m.guess, null, 'no best guess, so CardDetails falls back to pickRepresentative');
    assert.equal(m.top, '667');
    assert.equal(guess('Book of Mazarbul', footer).top, '567');
  }
  // The name-only search (the main Scan tab takes candidates[0]) breaks the same tie the same way.
  assert.equal(index.search('The Mouth of Sauron')[0]!.printing.collectorNumber, '667');
  assert.equal(index.search('Book of Mazarbul')[0]!.printing.collectorNumber, '567');
});

test('a footer with the right set but a wrong number is not a guess either: still 667 / 567', () => {
  const m = guess('The Mouth of Sauron', ['0219 U', 'LTR • EN']);
  assert.equal(m.ranking.printingConfidence, 'none');
  assert.equal(m.guess, null);
  assert.equal(m.top, '667');
  // Set read, number unreadable: two printings share the set, so it is not "partial" either.
  assert.equal(guess('Book of Mazarbul', ['LTR • EN']).ranking.printingConfidence, 'none');
});

test('a P/T box read above the footer can outrank the real number (the first "n/m" wins)', () => {
  // printingRegion is the bottom 28% of the card, which includes a creature's power/toughness box.
  const footer = ['4/4', '0216/0281 U', 'LTR • EN'];
  assert.equal(printingHints(footer, index.setCodes).collectorNumber, '4');
  assert.equal(guess('The Mouth of Sauron', footer).top, '667');
});

test('the picture check runs when the footer was not exact, and not at all when it was', () => {
  assert.equal(artCandidates(guess('Book of Mazarbul', []).ranking)?.length, 2);
  assert.equal(artCandidates(guess('Book of Mazarbul', ['0116 U', 'LTR • EN']).ranking), null);
});

test('a name-only read resolves the card; the printing it carries is the newest, not the lowest number', () => {
  const pipeline = new ScanPipeline(index, {} as never);
  const candidates = pipeline.matchEvidence({ lines: ['Oliphaunt'], printingLines: [] }).candidates;
  assert.equal(candidates[0]!.printing.name, 'Oliphaunt');
  assert.equal(candidates[0]!.printing.collectorNumber, '590');
});
