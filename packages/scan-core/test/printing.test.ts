import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, ScanPipeline, printingHints, rankPrintings, artVerdict, artShortlist, decidePrinting, usableArt, withTimeout, pinStillValid, needsPrintingConfirm, ART_CONFIDENCE_RATIO, PICKER_OPTIONS, type CatalogBundle, type Printing } from '../src';

const oracle = '00000000-0000-4000-8000-00000000aaaa';
const mk = (n: number, setCode: string, collectorNumber: string, extra: Partial<Printing> = {}): Printing => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, oracleId: oracle, name: 'Gigantosaurus', aliases: [], setCode, collectorNumber,
  finishes: ['nonfoil', 'foil'], language: 'en', imageUri: `https://img.example/${n}.jpg`, releasedAt: '2020-01-01', rarity: 'rare', ...extra,
});
const m19 = mk(1, 'm19', '185', { releasedAt: '2018-07-13' });
const fdn = mk(2, 'fdn', '718', { releasedAt: '2024-11-15', finishes: ['foil'] });
const slz = mk(3, 'slz', '76', { releasedAt: '2024-08-01' });
const promo = mk(4, 'pm19', '185s', { releasedAt: '2018-07-01' });
const all = [m19, fdn, slz, promo];
const sets = new Set(all.map(p => p.setCode));

test('printingHints: number and set on separate footer lines, with a rarity letter', () => {
  assert.deepEqual(printingHints(['M 0718', 'FDN • EN'], sets), { setCode: 'FDN', collectorNumber: '0718', rarity: 'mythic' });
  assert.deepEqual(printingHints(['0718 R', 'FDN · EN'], sets), { setCode: 'FDN', collectorNumber: '0718', rarity: 'rare' });
});

test('printingHints: the older "number/print run" footer, and the one-line form', () => {
  assert.deepEqual(printingHints(['185/280 R', 'M19 • EN'], sets), { setCode: 'M19', collectorNumber: '185', rarity: 'rare' });
  assert.deepEqual(printingHints(['FDN 718']), { setCode: 'FDN', collectorNumber: '718' });
});

test('printingHints: a language code is never the set, artist and copyright lines are ignored', () => {
  assert.deepEqual(printingHints(['0718', 'EN']), { collectorNumber: '0718' });
  assert.deepEqual(printingHints(['Illus. Aaron Miller 2024', '™ & © 2024 Wizards of the Coast', '0718', 'FDN EN'], sets), { setCode: 'FDN', collectorNumber: '0718' });
});

test('printingHints: with the catalog\'s set codes, an unknown token is not taken for a set; the number survives', () => {
  assert.deepEqual(printingHints(['0718', 'FDM • EN'], sets), { collectorNumber: '0718' });
  assert.deepEqual(printingHints([], sets), {});
  assert.deepEqual(printingHints(['~~ ,, ..'], sets), {});
});

test('rankPrintings: exact needs set and number to name one printing; leading zeros do not matter', () => {
  const r = rankPrintings(all, { setCode: 'FDN', collectorNumber: '0718' });
  assert.equal(r.printingConfidence, 'exact');
  assert.equal(r.ranked[0]!.printing.id, fdn.id);
});

test('rankPrintings: number alone or set alone is only "partial", and a single printing is "unique"', () => {
  assert.equal(rankPrintings(all, { collectorNumber: '718' }).printingConfidence, 'partial');
  assert.equal(rankPrintings(all, { setCode: 'slz' }).printingConfidence, 'partial');
  assert.equal(rankPrintings(all, {}).printingConfidence, 'none');
  assert.equal(rankPrintings([fdn], {}).printingConfidence, 'unique');
});

test('rankPrintings: evidence that fits nothing drops nothing, and a set with two printings is not settled', () => {
  const misread = rankPrintings(all, { setCode: 'FDN', collectorNumber: '999' });
  assert.equal(misread.ranked.length, 4);
  assert.equal(misread.printingConfidence, 'partial', 'the set still names one printing; the unmatched number just is not corroboration');
  assert.equal(rankPrintings(all, { setCode: 'FDN', collectorNumber: '185' }).printingConfidence, 'partial', 'set says FDN, number says M19: conflicting single matches never reach exact');
  const two = rankPrintings([...all, mk(5, 'fdn', '719', { releasedAt: '2024-11-15' })], { setCode: 'fdn' });
  assert.equal(two.printingConfidence, 'none');
});

test('rankPrintings: ties break newest release first, then set and number, not by id', () => {
  const ordered = rankPrintings(all, {}).ranked.map(r => r.printing.setCode);
  assert.deepEqual(ordered, ['fdn', 'slz', 'm19', 'pm19']);
  // Same input in any order gives the same order.
  assert.deepEqual(rankPrintings([...all].reverse(), {}).ranked.map(r => r.printing.setCode), ordered);
  // Rarity letter breaks a tie among otherwise equal fits.
  const common = mk(6, 'zzz', '1', { releasedAt: '2030-01-01', rarity: 'common' });
  assert.equal(rankPrintings([common, fdn], { rarity: 'rare' }).ranked[0]!.printing.id, fdn.id);
});

test('CardIndex: printingsOf and setCodes expose what the footer step needs; pipeline reads the split footer', () => {
  const bundle: CatalogBundle = { schemaVersion: 1, version: 't', generatedAt: '2026-01-01T00:00:00Z', printings: all };
  const index = new CardIndex(bundle);
  assert.equal(index.printingsOf(oracle).length, 4);
  assert.deepEqual(index.printingsOf('00000000-0000-4000-8000-000000000000'), []);
  assert.ok(index.setCodes.has('fdn'));
  const pipeline = new ScanPipeline(index, { readText: async () => ({ lines: [] }) });
  const top = pipeline.matchEvidence({ lines: ['Gigantosaurus'], printingLines: ['0718', 'FDN • EN'] }).candidates[0]!;
  assert.equal(top.printing.id, fdn.id);
  assert.equal(top.evidence, 'printing');
  // Name only: no longer a random printing but the newest, deterministically.
  assert.equal(pipeline.matchEvidence({ lines: ['Gigantosaurus'] }).candidates[0]!.printing.id, fdn.id);
});

test('artVerdict: clear winner is confident, a tie (identical art) never is, junk gives null', () => {
  assert.deepEqual(artVerdict({ ids: ['a', 'b', 'c'], distances: [0.2, 0.5, 0.6] }), { bestId: 'a', confident: true });
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [0.3, 0.3] })!.confident, false);
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [0.3, 0.3 * ART_CONFIDENCE_RATIO + 0.001] })!.confident, false);
  assert.equal(artVerdict({ ids: [], distances: [] }), null);
  assert.equal(artVerdict({ ids: ['a'], distances: [NaN] }), null);
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [1] }), null);
});

test('artShortlist: only printings with a picture, best footer fit first, capped', () => {
  const bare = mk(7, 'bbb', '1', { imageUri: undefined });
  const ranked = rankPrintings([bare, ...all], { setCode: 'slz' }).ranked;
  const list = artShortlist(ranked, 2);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, slz.id);
  assert.ok(!artShortlist(ranked).some(p => p.id === bare.id));
});

const art = (pairs: Array<[Printing, number]>) => ({ ids: pairs.map(([p]) => p.id), distances: pairs.map(([, d]) => d) });

test('decidePrinting: a card with one printing needs no verification', () => {
  const d = decidePrinting(rankPrintings([fdn], {}), null);
  assert.deepEqual(d, { kind: 'pinned', printing: fdn });
});

test('decidePrinting: exact footer that the picture also prefers is pinned', () => {
  const ranking = rankPrintings(all, { setCode: 'FDN', collectorNumber: '718' });
  const d = decidePrinting(ranking, art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]]));
  assert.deepEqual(d, { kind: 'pinned', printing: fdn });
});

test('decidePrinting: exact footer with pictures the comparison cannot separate asks, unless the artwork is known identical', () => {
  const ranking = rankPrintings(all, { setCode: 'm19', collectorNumber: '185' });
  const tied = art([[m19, 0.10], [promo, 0.10], [fdn, 0.7], [slz, 0.7]]);
  // Different pictures on file: a tie is not proof they match, so ask.
  const asked = decidePrinting(ranking, tied);
  assert.equal(asked.kind, 'choose');
  if (asked.kind === 'choose') { assert.equal(asked.reason, 'unsure'); assert.equal(asked.best, m19.id); }
  // Same image address for every printing: the footer is the only separator and it is exact.
  const same = all.map(p => ({ ...p, imageUri: 'https://img.example/shared.jpg' }));
  const sameRanking = rankPrintings(same, { setCode: 'm19', collectorNumber: '185' });
  assert.equal(decidePrinting(sameRanking, tied).kind, 'pinned');
  assert.equal(decidePrinting(sameRanking, null).kind, 'pinned', 'no picture needed when the artwork is identical');
  // ...but a partial footer never pins on that basis.
  assert.equal(decidePrinting(rankPrintings(same, { collectorNumber: '185' }), null).kind, 'choose');
});

test('decidePrinting: partial coverage never pins on the picture alone', () => {
  const none = rankPrintings(all, {});
  // Only two of four were compared (failed downloads); a clear winner among them proves nothing.
  const d = decidePrinting(none, art([[fdn, 0.1], [m19, 0.6]]));
  assert.equal(d.kind, 'choose');
  // A -1 (uncomparable) result is treated as unusable, so it cannot count as coverage.
  assert.equal(decidePrinting(none, { ids: all.map(p => p.id), distances: [0.1, 0.6, 0.7, -1] }).kind, 'choose');
});

test('decidePrinting: one survivor of many is not a winner', () => {
  const d = decidePrinting(rankPrintings(all, {}), art([[fdn, 0.1]]));
  assert.equal(d.kind, 'choose');
  // Even a partial footer naming the survivor does not pin it.
  assert.equal(decidePrinting(rankPrintings(all, { collectorNumber: '718' }), art([[fdn, 0.1]])).kind, 'choose');
});

test('decidePrinting: partial coverage pins only with an exact footer that agrees with the picture', () => {
  const partialArt = art([[fdn, 0.1], [m19, 0.6]]);
  assert.deepEqual(decidePrinting(rankPrintings(all, { setCode: 'FDN', collectorNumber: '718' }), partialArt), { kind: 'pinned', printing: fdn });
  // Exact footer naming a different printing than the picture: ask.
  assert.equal(decidePrinting(rankPrintings(all, { setCode: 'm19', collectorNumber: '185' }), partialArt).kind, 'choose');
});

test('decidePrinting: more printings than the shortlist cap never pin from the picture alone', () => {
  const many = Array.from({ length: 30 }, (_, i) => mk(10 + i, 'xx' + i, String(i + 1)));
  const noFooter = rankPrintings(many, {});
  const shortlist = artShortlist(noFooter.ranked);
  assert.equal(shortlist.length, 24);
  const winner = art(shortlist.map((p, i): [Printing, number] => [p, i === 0 ? 0.1 : 0.8]));
  assert.equal(decidePrinting(noFooter, winner).kind, 'choose');
  // With an exact footer that agrees with the confident winner it may pin.
  const exact = rankPrintings(many, { setCode: 'xx3', collectorNumber: '4' });
  const list = artShortlist(exact.ranked);
  const agree = art(list.map((p, i): [Printing, number] => [p, i === 0 ? 0.1 : 0.8]));
  assert.equal(decidePrinting(exact, agree).kind, 'pinned');
});

test('decidePrinting: a printing with no picture on file keeps the picture from pinning', () => {
  const bare = mk(7, 'bbb', '1', { imageUri: undefined });
  const withBare = [...all, bare];
  const shortlisted = artShortlist(rankPrintings(withBare, {}).ranked);
  const d = decidePrinting(rankPrintings(withBare, {}), art(shortlisted.map((p, i): [Printing, number] => [p, i === 0 ? 0.1 : 0.8])));
  assert.equal(d.kind, 'choose');
});

test('decidePrinting: footer and a confident picture disagree, so the person is asked, picture winner highlighted', () => {
  const ranking = rankPrintings(all, { setCode: 'm19', collectorNumber: '185' });
  const d = decidePrinting(ranking, art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]]));
  assert.equal(d.kind, 'choose');
  if (d.kind === 'choose') {
    assert.equal(d.reason, 'disagree');
    assert.equal(d.best, fdn.id);
    assert.equal(d.options[0]!.id, fdn.id);
    assert.ok(d.options.some(p => p.id === m19.id), 'the footer\'s printing stays on offer');
  }
});

test('decidePrinting: an exact footer whose own picture is clearly not among the closest is not trusted', () => {
  const ranking = rankPrintings(all, { setCode: 'slz', collectorNumber: '76' });
  // Not confident (two close leaders) but the footer's printing is far behind them.
  const d = decidePrinting(ranking, art([[fdn, 0.10], [promo, 0.105], [slz, 0.9], [m19, 0.9]]));
  assert.equal(d.kind, 'choose');
});

test('decidePrinting: with no footer, even a clearly closest picture only highlights; it never pins', () => {
  const none = rankPrintings(all, {});
  const clear = decidePrinting(none, art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]]));
  assert.equal(clear.kind, 'choose');
  if (clear.kind === 'choose') { assert.equal(clear.best, fdn.id); assert.equal(clear.options[0]!.id, fdn.id); }
  // A near-perfect distance changes nothing: art alone is never a pin among several.
  assert.equal(decidePrinting(none, art([[fdn, 0.0001], [m19, 5], [slz, 5], [promo, 5]])).kind, 'choose');
  const unsure = decidePrinting(none, art([[fdn, 0.30], [m19, 0.31], [slz, 0.7], [promo, 0.65]]));
  assert.equal(unsure.kind, 'choose');
  if (unsure.kind === 'choose') assert.equal(unsure.reason, 'unsure');
});

test('decidePrinting: partial footer agreeing with a confident picture over every printing pins; disagreeing asks', () => {
  const partial = rankPrintings(all, { collectorNumber: '718' });
  assert.equal(decidePrinting(partial, art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]])).kind, 'pinned');
  const wrong = decidePrinting(partial, art([[slz, 0.1], [m19, 0.6], [fdn, 0.7], [promo, 0.65]]));
  assert.equal(wrong.kind, 'choose');
});

test('decidePrinting: with no picture (old native build, failed download) several printings always ask, never guess', () => {
  const exact = decidePrinting(rankPrintings(all, { setCode: 'FDN', collectorNumber: '718' }), null);
  assert.equal(exact.kind, 'choose');
  if (exact.kind === 'choose') { assert.equal(exact.reason, 'no-art'); assert.equal(exact.best, fdn.id); }
  const blank = decidePrinting(rankPrintings(all, {}), null);
  assert.equal(blank.kind, 'choose');
  if (blank.kind === 'choose') assert.equal(blank.best, null);
  // Unusable numbers count as no picture too.
  assert.equal(decidePrinting(rankPrintings(all, {}), { ids: [fdn.id], distances: [NaN] }).kind, 'choose');
});

test('decidePrinting: the picker is capped and best guess leads', () => {
  const many = Array.from({ length: 20 }, (_, i) => mk(10 + i, 'xx' + i, String(i + 1)));
  const d = decidePrinting(rankPrintings(many, { setCode: 'xx7', collectorNumber: '8' }), null);
  assert.equal(d.kind, 'choose');
  if (d.kind === 'choose') { assert.equal(d.options.length, PICKER_OPTIONS); assert.equal(d.options[0]!.setCode, 'xx7'); }
});

test('decidePrinting: a partial footer agreeing with a picture that did not cover every printing still asks', () => {
  const partial = rankPrintings(all, { collectorNumber: '718' });
  assert.equal(decidePrinting(partial, art([[fdn, 0.1], [m19, 0.6]])).kind, 'choose');
  // Exact footer + agreeing confident picture pins even on a subset: two independent signals.
  assert.equal(decidePrinting(rankPrintings(all, { setCode: 'fdn', collectorNumber: '718' }), art([[fdn, 0.1], [m19, 0.6]])).kind, 'pinned');
});

test('decidePrinting: whatever the picture says, several printings and no footer never pin', () => {
  const none = rankPrintings(all, {});
  for (const winner of all) {
    const pairs = all.map((p): [Printing, number] => [p, p.id === winner.id ? 0.01 : 9]);
    assert.equal(decidePrinting(none, art(pairs)).kind, 'choose', `winner ${winner.setCode}`);
  }
});

test('usableArt: drops -1, NaN, negative, missing and non-number distances, keeps ids aligned', () => {
  assert.deepEqual(usableArt(['a', 'b', 'c', 'd', 'e', 'f'], [0.2, -1, NaN, null, 0.5, Infinity]), { ids: ['a', 'e'], distances: [0.2, 0.5] });
  assert.deepEqual(usableArt(['a', 'b'], [0.2]), { ids: ['a'], distances: [0.2] }, 'a short result drops the missing candidate');
  assert.equal(usableArt(['a', 'b'], [-1, -1]), null);
  assert.equal(usableArt(['a'], null), null);
  assert.equal(usableArt([], []), null);
  assert.deepEqual(usableArt(['a'], [0]), { ids: ['a'], distances: [0] }, 'zero is a perfect match, not junk');
});

test('withTimeout: resolves with the work, falls back when late or failing, and ignores a late result', async () => {
  assert.equal(await withTimeout(Promise.resolve('done'), 50, 'fallback'), 'done');
  assert.equal(await withTimeout(new Promise<string>(r => setTimeout(() => r('late'), 80)), 10, 'fallback'), 'fallback');
  assert.equal(await withTimeout(Promise.reject(new Error('boom')), 50, 'fallback'), 'fallback');
  // The timer is cleared on success: this would keep the process alive for a minute if it were not.
  const started = Date.now();
  await withTimeout(Promise.resolve(1), 60_000, 0);
  assert.ok(Date.now() - started < 1000);
});

test('pinStillValid: a stale catalog cannot vouch for a pin the live table has more printings for', () => {
  assert.equal(pinStillValid('a', ['a'], ['a']), true);
  assert.equal(pinStillValid('a', ['a'], ['a', 'b']), false, 'a unique pin with a newer live printing must ask');
  assert.equal(pinStillValid('a', ['a', 'b'], ['a']), true, 'the live list knowing less is fine');
  assert.equal(pinStillValid('a', ['a', 'b'], ['b']), false, 'the pinned printing must exist live');
  assert.equal(pinStillValid('a', ['a', 'b'], ['a', 'b', 'c']), false);
  assert.equal(pinStillValid(null, ['a'], ['a']), false);
  assert.equal(pinStillValid('a', ['a'], []), false);
});

test('needsPrintingConfirm: only a verified scan with no surviving pin and no confirmation asks', () => {
  const pinned = { pinned: true, bestId: 'a', knownIds: ['a'] };
  assert.equal(needsPrintingConfirm({ verify: undefined, confirmed: false, liveIds: ['a', 'b'] }), false, 'not a scan');
  assert.equal(needsPrintingConfirm({ verify: pinned, confirmed: false, liveIds: ['a'] }), false);
  assert.equal(needsPrintingConfirm({ verify: pinned, confirmed: false, liveIds: ['a', 'b'] }), true, 'stale catalog');
  assert.equal(needsPrintingConfirm({ verify: pinned, confirmed: false, liveIds: [] }), true, 'nothing loaded must fail closed');
  assert.equal(needsPrintingConfirm({ verify: pinned, confirmed: true, liveIds: ['a', 'b'] }), false, 'the person confirmed');
  assert.equal(needsPrintingConfirm({ verify: { bestId: 'a', knownIds: ['a', 'b'] }, confirmed: false, liveIds: ['a', 'b'] }), true, 'not pinned');
  assert.equal(needsPrintingConfirm({ verify: { bestId: null, knownIds: ['a'], pinned: true }, confirmed: false, liveIds: ['a'] }), true);
});
