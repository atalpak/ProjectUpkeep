import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, ScanPipeline, printingHints, rankPrintings, artVerdict, artShortlist, bestGuessPrinting, artCandidates, artSwitchTarget, artSwitchNow, usableArt, withTimeout, regularFirst, thumbnailUri, finishSummary, ART_CONFIDENCE_RATIO, ART_OVERRIDE_FOOTER_RATIO, type CatalogBundle, type Printing } from '../src';

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
  assert.deepEqual(printingHints(['M 0718', 'FDN • EN'], sets), { setCode: 'FDN', collectorNumber: '0718', rarity: 'mythic', language: 'en' });
  assert.deepEqual(printingHints(['0718 R', 'FDN · EN'], sets), { setCode: 'FDN', collectorNumber: '0718', rarity: 'rare', language: 'en' });
});

test('printingHints: the older "number/print run" footer, and the one-line form', () => {
  assert.deepEqual(printingHints(['185/280 R', 'M19 • EN'], sets), { setCode: 'M19', collectorNumber: '185', rarity: 'rare', language: 'en' });
  assert.deepEqual(printingHints(['FDN 718']), { setCode: 'FDN', collectorNumber: '718' }, 'no language token on the line: no guess');
});

test('printingHints: a language code is never the set, artist and copyright lines are ignored', () => {
  assert.deepEqual(printingHints(['0718', 'EN']), { collectorNumber: '0718', language: 'en' });
  assert.deepEqual(printingHints(['Illus. Aaron Miller 2024', '™ & © 2024 Wizards of the Coast', '0718', 'FDN EN'], sets), { setCode: 'FDN', collectorNumber: '0718', language: 'en' });
});

test('printingHints: with the catalog\'s set codes, an unknown token is not taken for a set; the number survives', () => {
  // FDM is still rejected as a set (unknown to `sets`) even though the language
  // token beside it is captured regardless -- the two are independent reads.
  assert.deepEqual(printingHints(['0718', 'FDM • EN'], sets), { collectorNumber: '0718', language: 'en' });
  assert.deepEqual(printingHints([], sets), {});
  assert.deepEqual(printingHints(['~~ ,, ..'], sets), {});
});

test('printingHints: footer language token -> LanguageCode, and the exclusion-from-set-code behaviour it must not break', () => {
  // "SOC • JA" style: the language token sits beside the set code.
  assert.deepEqual(printingHints(['0236', 'SOC • JA'], new Set(['soc'])), { setCode: 'SOC', collectorNumber: '0236', language: 'ja' });
  // JP is Scryfall/footer shorthand for Japanese too, and maps to the same code.
  assert.deepEqual(printingHints(['0236', 'SOC • JP'], new Set(['soc'])).language, 'ja');
  // A bare "ZH" is genuinely ambiguous (Simplified vs Traditional); the documented
  // guess is `zhs`, not left undefined.
  assert.deepEqual(printingHints(['0236', 'SOC • ZH'], new Set(['soc'])).language, 'zhs');
  assert.deepEqual(printingHints(['0236', 'SOC • ZHS'], new Set(['soc'])).language, 'zhs');
  assert.deepEqual(printingHints(['0236', 'SOC • ZHT'], new Set(['soc'])).language, 'zht');
  // No recognizable language token on any line: `language` stays undefined.
  assert.equal(printingHints(['0236', 'SOC'], new Set(['soc'])).language, undefined);
  // Regression: a language token must still never be mistaken for the set
  // code itself, exactly as before this field existed.
  const hints = printingHints(['0236', 'JA • SOC'], new Set(['soc', 'ja']));
  assert.equal(hints.setCode, 'SOC', 'JA is excluded from set-code candidacy even though it sits where a set could');
  assert.equal(hints.language, 'ja');
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

test('rankPrintings: ties prefer the regular print (plain number, nonfoil), then newest, not by id', () => {
  const ordered = rankPrintings(all, {}).ranked.map(r => r.printing.setCode);
  // slz and m19 are ordinary nonfoil prints (newest first); fdn is foil-only; pm19 is a promo-numbered "185s".
  assert.deepEqual(ordered, ['slz', 'm19', 'fdn', 'pm19']);
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
  // Name only: no longer a random printing but the regular one, deterministically.
  assert.equal(pipeline.matchEvidence({ lines: ['Gigantosaurus'] }).candidates[0]!.printing.id, slz.id);
});

test('artVerdict: clear winner is confident, a tie (identical art) never is, junk gives null', () => {
  assert.deepEqual(artVerdict({ ids: ['a', 'b', 'c'], distances: [0.2, 0.5, 0.6] }), { bestId: 'a', confident: true });
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [0.3, 0.3] })!.confident, false);
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [0.3, 0.3 * ART_CONFIDENCE_RATIO + 0.001] })!.confident, false);
  assert.equal(artVerdict({ ids: ['a', 'b'], distances: [0.28, 0.3] })!.confident, false, 'a 7% margin is what glare produces; it must not count');
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

test('bestGuessPrinting: exact, partial and unique name one; nothing else guesses', () => {
  assert.equal(bestGuessPrinting(rankPrintings(all, { setCode: 'FDN', collectorNumber: '718' }))?.id, fdn.id);
  assert.equal(bestGuessPrinting(rankPrintings(all, { collectorNumber: '76' }))?.id, slz.id, 'a lone matching number is a partial guess');
  assert.equal(bestGuessPrinting(rankPrintings([fdn], {}))?.id, fdn.id);
  assert.equal(bestGuessPrinting(rankPrintings(all, {})), null, 'no footer: the caller uses its default');
  assert.equal(bestGuessPrinting(rankPrintings(all, { rarity: 'rare' })), null, 'rarity alone is not a guess');
});

test('artCandidates: skipped when the footer settled it, or the picture could not cover every printing', () => {
  assert.equal(artCandidates(rankPrintings([fdn], {})), null, 'one printing');
  assert.equal(artCandidates(rankPrintings(all, { setCode: 'FDN', collectorNumber: '718' })), null, 'exact footer');
  assert.equal(artCandidates(rankPrintings(all, {}))!.length, all.length);
  assert.equal(artCandidates(rankPrintings([...all, mk(7, 'bbb', '1', { imageUri: undefined })], {})), null, 'a printing with no picture');
  const many = Array.from({ length: 30 }, (_, i) => mk(10 + i, `x${i}`, String(i)));
  assert.equal(artCandidates(rankPrintings(many, {})), null, 'more than the cap can never be fully compared');
  assert.equal(artCandidates(rankPrintings(all, { collectorNumber: '76' }))!.length, all.length, 'a partial footer still checks');
});

test('artSwitchTarget: only a confident winner over every printing may switch the selection', () => {
  assert.equal(artSwitchTarget(all, art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]]))?.id, fdn.id);
  assert.equal(artSwitchTarget(all, art([[fdn, 0.1], [m19, 0.6]])), null, 'a subset proves nothing about the rest');
  assert.equal(artSwitchTarget(all, art([[fdn, 0.30], [m19, 0.31], [slz, 0.7], [promo, 0.65]])), null, 'not clearly closer');
  assert.equal(artSwitchTarget(all, art([[fdn, 0.2], [m19, 0.2], [slz, 0.2], [promo, 0.2]])), null, 'identical pictures never win');
  assert.equal(artSwitchTarget(all, { ids: all.map(p => p.id), distances: [0.1, 0.6, 0.7, NaN] }), null, 'junk distances');
  assert.equal(artSwitchTarget(all, null), null);
  assert.equal(artSwitchTarget([fdn], art([[fdn, 0.1]])), null, 'nothing to switch between');
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

test('artSwitchNow: a stale card, a made choice or an open form all leave the selection alone', () => {
  const a = art([[fdn, 0.1], [m19, 0.6], [slz, 0.7], [promo, 0.65]]);
  const base = { name: fdn.name, artName: fdn.name, all, art: a, userPicked: false, adding: false };
  assert.equal(artSwitchNow(base)?.id, fdn.id);
  assert.equal(artSwitchNow({ ...base, name: null }), null, 'sheet closed');
  assert.equal(artSwitchNow({ ...base, name: 'Other Card' }), null, 'sheet reopened on another card: stale list and art');
  assert.equal(artSwitchNow({ ...base, artName: 'Other Card' }), null, 'art computed for the previous card');
  assert.equal(artSwitchNow({ ...base, artName: null }), null);
  assert.equal(artSwitchNow({ ...base, all: [...all, { ...promo, id: 'zzz', name: 'Other Card' }] }), null, 'list holds another card');
  assert.equal(artSwitchNow({ ...base, userPicked: true }), null, 'the person chose');
  assert.equal(artSwitchNow({ ...base, adding: true }), null, 'add form open');
  assert.equal(artSwitchNow({ ...base, art: art([[fdn, 0.3], [m19, 0.31], [slz, 0.7], [promo, 0.65]]) }), null, 'not confident');
  assert.equal(artSwitchNow({ ...base, all: [], art: null }), null);
});

// The real shape of the Bloodline Bidding report: ECL #0091 scanned, ECL #0385 opened.
const eclOracle = '00000000-0000-4000-8000-00000000bbbb';
const ecl = (n: number, setCode: string, collectorNumber: string, finishes: Printing['finishes'], releasedAt = '2026-01-23'): Printing => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, oracleId: eclOracle, name: 'Bloodline Bidding', aliases: [], setCode, collectorNumber,
  finishes, language: 'en', imageUri: `https://img.example/ecl${n}.jpg`, releasedAt, rarity: 'rare',
});
const bb91 = ecl(1, 'ecl', '91', ['nonfoil', 'foil']);
const bb359 = ecl(2, 'ecl', '359', ['nonfoil', 'foil']);
const bb385 = ecl(3, 'ecl', '385', ['foil']);
const bb395 = ecl(4, 'ecl', '395', ['foil']);
const bbPromo = ecl(5, 'pecl', '91p', ['nonfoil', 'foil'], '2026-02-06');
const bidding = [bb385, bb395, bbPromo, bb359, bb91];

test('regularFirst: the ordinary print of a set wins whatever order the database returned', () => {
  for (const order of [bidding, [...bidding].reverse(), [bb359, bb91, bbPromo, bb395, bb385]]) {
    assert.deepEqual([...order].sort(regularFirst).map(p => p.collectorNumber), ['91', '359', '385', '395', '91p']);
  }
});

test('regularFirst: a footer that failed to read opens the regular print, not a foil-only showcase', () => {
  // No footer evidence at all, and set-only evidence (bySet has four printings): both fall back to the ordering.
  assert.equal(rankPrintings(bidding, {}).ranked[0]!.printing.id, bb91.id);
  assert.equal(rankPrintings(bidding, { setCode: 'ecl' }).ranked[0]!.printing.id, bb91.id);
  assert.equal(rankPrintings(bidding, { setCode: 'ecl' }).printingConfidence, 'none');
  assert.equal(bestGuessPrinting(rankPrintings(bidding, {})), null, 'and nothing pretends to be a guess');
  // A garbled number reading "385" is still a footer match, and is honoured as evidence.
  assert.equal(rankPrintings(bidding, { setCode: 'ecl', collectorNumber: '385' }).ranked[0]!.printing.id, bb385.id);
});

test('regularFirst: the clean footer of the report resolves exactly, and the promo number is not the same as 91', () => {
  const hints = printingHints(['0091', 'ECL • EN'], new Set(['ecl', 'pecl']));
  assert.deepEqual(hints, { setCode: 'ECL', collectorNumber: '0091', language: 'en' });
  const ranking = rankPrintings(bidding, hints);
  assert.equal(ranking.printingConfidence, 'exact');
  assert.equal(ranking.ranked[0]!.printing.id, bb91.id);
  assert.equal(rankPrintings(bidding, { collectorNumber: '0091' }).printingConfidence, 'partial', '91p is a different number from 91');
});

test('regularFirst: across sets the newer release wins; number only ranks within the same release', () => {
  const older = mk(20, 'aaa', '5', { releasedAt: '2019-01-01' });
  const newer = mk(21, 'zzz', '400', { releasedAt: '2025-01-01' });
  assert.equal([older, newer].sort(regularFirst)[0]!.id, newer.id);
  // Structural: a mobile-shaped printing (readonly finishes, null release date) works too.
  const a = { id: 'a', setCode: 'x', collectorNumber: '2', finishes: ['nonfoil'] as const, releasedAt: null };
  const b = { id: 'b', setCode: 'x', collectorNumber: '1', finishes: ['nonfoil'] as const, releasedAt: null };
  assert.equal([a, b].sort(regularFirst)[0]!.id, 'b');
});

test('art switch: a 0.8 ratio no longer switches, and a footer-named printing needs an overwhelming picture', () => {
  assert.ok(ART_CONFIDENCE_RATIO <= 0.75 && ART_OVERRIDE_FOOTER_RATIO < ART_CONFIDENCE_RATIO);
  const distances = (best: number) => art(bidding.map((p, i) => [p, i === 0 ? best : 1] as [Printing, number]));
  assert.equal(artSwitchTarget(bidding, distances(0.8)), null, 'only 20% closer: not decisive');
  assert.equal(artSwitchTarget(bidding, distances(0.7))?.id, bb385.id, 'a quarter closer is decisive');
  const base = { name: 'Bloodline Bidding', artName: 'Bloodline Bidding', all: bidding, userPicked: false, adding: false };
  assert.equal(artSwitchNow({ ...base, art: distances(0.7) })?.id, bb385.id, 'no footer: the default may be overruled');
  assert.equal(artSwitchNow({ ...base, art: distances(0.7), footerGuess: true }), null, 'a footer-named printing is not overruled by a 30% margin');
  assert.equal(artSwitchNow({ ...base, art: distances(0.4), footerGuess: true })?.id, bb385.id, 'but is by an overwhelming one');
});

test('thumbnailUri swaps the Scryfall size segment and leaves other addresses alone', () => {
  assert.equal(thumbnailUri('https://cards.scryfall.io/normal/front/a/b/abc.jpg?1700000000'), 'https://cards.scryfall.io/small/front/a/b/abc.jpg?1700000000');
  assert.equal(thumbnailUri('https://cards.scryfall.io/large/back/a/b/abc.jpg'), 'https://cards.scryfall.io/small/back/a/b/abc.jpg');
  assert.equal(thumbnailUri('https://img.example/1.jpg'), 'https://img.example/1.jpg');
  assert.equal(thumbnailUri(null), null);
  assert.equal(thumbnailUri(''), null);
});

test('finishSummary reads a lone finish as "only" and several as a list', () => {
  assert.equal(finishSummary(['foil']), 'Foil only');
  assert.equal(finishSummary(['nonfoil', 'foil']), 'Nonfoil / Foil');
  assert.equal(finishSummary(['nonfoil', 'foil', 'etched']), 'Nonfoil / Foil / Etched');
  assert.equal(finishSummary([]), '');
});
