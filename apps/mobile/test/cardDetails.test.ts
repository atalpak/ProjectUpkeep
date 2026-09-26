/**
 * Tests for src/cardDetails.ts -- the data behind the card details sheet.
 *
 * This is where the recent details-sheet fixes live, so the tests are organised
 * around the failure each one was for: a request that hangs (8s deadline), a
 * failed lookup that used to read as "you own none" (owned-copies error state),
 * yesterday's price surviving in a long session (cache TTL), and a showcase
 * printing winning the default pick. `./backend` is replaced by a recording fake
 * (helpers/fake-backend.ts), so nothing here touches Supabase or React Native.
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import './helpers/clock'; // first: the caches capture Date.now when the module loads
import { flush, tick } from './helpers/clock';
import { FakeBackend, eqValue, fail, never, ok, setBackend, type Call, type Reply } from './helpers/fake-backend';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_TTL_MS, LOAD_FAILED, REQUEST_TIMEOUT_MS, cachedPrinting, cachedPrintings, fetchFriendActivity, fetchFriendSupplyCounts, fetchOwned,
  fetchPrinting, fetchPrintings, fetchScryfallExtras, fetchWantList, fetchWantedQuantity, pickRepresentative, seedToPrinting, toPrinting,
  type CardPrinting, type CardSeed,
} from '../src/cardDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type CardRow = Record<string, unknown>;

const cardRow = (over: CardRow = {}): CardRow => ({
  scryfall_id: 'id-1', oracle_id: 'oracle-1', name: 'Test Card', flavor_name: null, set_code: 'tst', set_name: 'Test Set',
  collector_number: '1', rarity: 'rare', released_at: '2024-01-01', set_type: 'expansion', image_uri: 'https://img/1.jpg',
  image_uri_small: 'https://img/1s.jpg', available_finishes: ['nonfoil', 'foil'], lang: 'en', mana_cost: '{1}{R}', type_line: 'Creature',
  oracle_text: 'Text', flavor_text: null, power: '2', toughness: '2', loyalty: null, artist: 'Someone', layout: 'normal', card_faces: null,
  price_usd: '1.50', price_usd_foil: null, price_usd_etched: null, scryfall_uri: 'https://scryfall/1', ...over,
});

const printing = (over: Partial<CardPrinting> = {}): CardPrinting => ({
  ...seedToPrinting({ id: 'p', name: 'Card', setCode: 'abc', collectorNumber: '10', rarity: 'rare', typeLine: null, image: null, imageSmall: null, priceUsd: null, priceUsdFoil: null, priceUsdEtched: null }),
  finishes: ['nonfoil'], releasedAt: '2024-01-01', setType: 'expansion', ...over,
});

const seed = (over: Partial<CardSeed> = {}): CardSeed => ({
  id: 's-1', name: 'Seeded', setCode: 'ecl', collectorNumber: '91', rarity: 'rare', typeLine: 'Instant', image: 'https://img/n.jpg', imageSmall: 'https://img/s.jpg',
  priceUsd: '2.25', priceUsdFoil: 5, priceUsdEtched: null, ...over,
});

const install = (respond: (call: Call) => Reply | Promise<Reply>): FakeBackend => {
  const fake = new FakeBackend(respond);
  setBackend(fake);
  return fake;
};

// ---------------------------------------------------------------------------
// seedToPrinting / toPrinting
// ---------------------------------------------------------------------------

test('seedToPrinting has no finishes, so Add to collection stays off until the real row lands', () => {
  const p = seedToPrinting(seed());
  assert.deepEqual(p.finishes, []);
  assert.equal(p.full, false);
});

test('seedToPrinting paints what the caller knew and nothing it did not', () => {
  const p = seedToPrinting(seed());
  assert.equal(p.setName, 'ECL'); // no set name in a seed: the upper-cased code, never blank
  assert.equal(p.oracleId, '');
  assert.equal(p.image, 'https://img/n.jpg');
  assert.equal(p.faces.length, 1);
  assert.equal(p.faces[0]!.image, 'https://img/n.jpg');
  assert.equal(p.faces[0]!.name, 'Seeded');
  assert.equal(p.oracleText, null);
});

test('seedToPrinting coerces prices: numeric strings parse, junk and null become null', () => {
  const p = seedToPrinting(seed({ priceUsd: '2.25', priceUsdFoil: 5, priceUsdEtched: null }));
  assert.equal(p.priceUsd, 2.25);
  assert.equal(p.priceUsdFoil, 5);
  assert.equal(p.priceUsdEtched, null);
  assert.equal(seedToPrinting(seed({ priceUsd: 'n/a' })).priceUsd, null);
});

test('seedToPrinting turns a missing rarity into an empty string', () => {
  assert.equal(seedToPrinting(seed({ rarity: null })).rarity, '');
});

test('toPrinting maps to the scan-core shape, dropping nulls to undefined', () => {
  const p = toPrinting(printing({ id: 'x', image: null, releasedAt: null, setName: 'Set', rarity: 'mythic' }));
  assert.equal(p.id, 'x');
  assert.equal(p.imageUri, undefined);
  assert.equal(p.releasedAt, undefined);
  assert.deepEqual(p.aliases, []);
  assert.equal(p.rarity, 'mythic');
  const withArt = toPrinting(printing({ image: 'https://img/a.jpg', releasedAt: '2024-05-05' }));
  assert.equal(withArt.imageUri, 'https://img/a.jpg');
  assert.equal(withArt.releasedAt, '2024-05-05');
});

// ---------------------------------------------------------------------------
// pickRepresentative
// ---------------------------------------------------------------------------

test('pickRepresentative on nothing is null', () => {
  assert.equal(pickRepresentative([]), null);
});

test('pickRepresentative prefers a regular set over a promo or memorabilia printing', () => {
  const promo = printing({ id: 'promo', setType: 'promo', releasedAt: '2026-01-01' });
  const memo = printing({ id: 'memo', setType: 'memorabilia', releasedAt: '2026-02-01' });
  const core = printing({ id: 'core', setType: 'core', releasedAt: '2015-01-01' });
  assert.equal(pickRepresentative([promo, memo, core])!.id, 'core');
});

test('pickRepresentative ranks an unknown or missing set type after the known ones', () => {
  const unknown = printing({ id: 'u', setType: null });
  const masters = printing({ id: 'm', setType: 'masters' });
  assert.equal(pickRepresentative([unknown, masters])!.id, 'm');
});

test('pickRepresentative: a foil-only showcase does not beat the regular print of the same set (ECL #385 vs #91)', () => {
  // The bug: printings of one set tied, and the winner was whichever the
  // database returned first. Both orders must now give the regular print.
  const regular = printing({ id: 'regular', setCode: 'ecl', collectorNumber: '91', finishes: ['nonfoil', 'foil'], releasedAt: '2026-01-16' });
  const showcase = printing({ id: 'showcase', setCode: 'ecl', collectorNumber: '385', finishes: ['foil'], releasedAt: '2026-01-16' });
  assert.equal(pickRepresentative([showcase, regular])!.id, 'regular');
  assert.equal(pickRepresentative([regular, showcase])!.id, 'regular');
});

test('pickRepresentative prefers a plain collector number over a promo-numbered one', () => {
  const promoNumber = printing({ id: 'promoNumber', collectorNumber: '91p', finishes: ['nonfoil'] });
  const plain = printing({ id: 'plain', collectorNumber: '91', finishes: ['nonfoil'] });
  assert.equal(pickRepresentative([promoNumber, plain])!.id, 'plain');
});

test('pickRepresentative takes the newest release once everything else ties, and does not mutate its input', () => {
  const older = printing({ id: 'older', releasedAt: '2019-01-01' });
  const newer = printing({ id: 'newer', releasedAt: '2023-01-01' });
  const input = [older, newer];
  assert.equal(pickRepresentative(input)!.id, 'newer');
  assert.deepEqual(input.map(p => p.id), ['older', 'newer']);
});

// ---------------------------------------------------------------------------
// fetchPrintings
// ---------------------------------------------------------------------------

test('fetchPrintings with no backend says why, in plain words', async () => {
  setBackend(null);
  const r = await fetchPrintings('No Backend');
  assert.deepEqual(r.printings, []);
  assert.match(r.error ?? '', /internet connection and an account/);
});

test('fetchPrintings asks for non-digital printings of that exact name and sorts newest first, unknown dates last', async () => {
  const fake = install(() => ok([
    cardRow({ scryfall_id: 'a', released_at: '2019-05-01' }),
    cardRow({ scryfall_id: 'b', released_at: null }),
    cardRow({ scryfall_id: 'c', released_at: '2024-05-01' }),
  ]));
  const r = await fetchPrintings('Sorted Card');
  assert.equal(r.error, null);
  assert.deepEqual(r.printings.map(p => p.id), ['c', 'a', 'b']);
  const call = fake.calls[0]!;
  assert.equal(call.table, 'cards');
  assert.equal(eqValue(call, 'name'), 'Sorted Card');
  assert.equal(eqValue(call, 'digital'), false);
});

test('fetchPrintings builds light rows: full is false, unknown finishes are dropped, a missing set name falls back to the code', async () => {
  install(() => ok([cardRow({ scryfall_id: 'light', set_name: null, set_code: 'abc', available_finishes: ['nonfoil', 'gilded', 'etched'] })]));
  const [p] = (await fetchPrintings('Light Card')).printings;
  assert.equal(p!.full, false);
  assert.equal(p!.setName, 'ABC');
  assert.deepEqual(p!.finishes, ['nonfoil', 'etched']);
});

test('fetchPrintings caches the list: the second call makes no query', async () => {
  const fake = install(() => ok([cardRow({ scryfall_id: 'cached-1' })]));
  await fetchPrintings('Cached List');
  const again = await fetchPrintings('Cached List');
  assert.equal(fake.calls.length, 1);
  assert.equal(again.printings.length, 1);
  assert.equal(cachedPrintings('Cached List')?.length, 1);
});

test('fetchPrintings does not cache an empty answer, so a transient empty does not stick', async () => {
  const fake = install(() => ok([]));
  await fetchPrintings('Empty Card');
  await fetchPrintings('Empty Card');
  assert.equal(fake.calls.length, 2);
  assert.equal(cachedPrintings('Empty Card'), undefined);
});

test('fetchPrintings gives a plain line, never the raw database message, on an error reply', async () => {
  install(() => fail('permission denied for table cards (42501)'));
  const r = await fetchPrintings('Denied Card');
  assert.equal(r.error, LOAD_FAILED);
  assert.deepEqual(r.printings, []);
  assert.doesNotMatch(r.error ?? '', /permission denied/);
});

test('fetchPrintings gives the same plain line when the request throws', async () => {
  install(() => { throw new Error('socket hang up'); });
  const r = await fetchPrintings('Throwing Card');
  assert.equal(r.error, LOAD_FAILED);
});

test('fetchPrintings gives up after the deadline instead of hanging, and does not cache the failure', async () => {
  const fake = install(() => never());
  const pending = fetchPrintings('Hanging Card');
  await flush();
  tick(REQUEST_TIMEOUT_MS - 1);
  await flush();
  tick(1);
  const r = await pending;
  assert.equal(r.error, LOAD_FAILED);
  assert.deepEqual(r.printings, []);
  // "Try again" must actually try again.
  install(() => ok([cardRow({ scryfall_id: 'hang-recovered' })]));
  assert.equal((await fetchPrintings('Hanging Card')).printings.length, 1);
  assert.equal(fake.calls.length, 1);
});

test('fetchPrintings expires a cached list after CACHE_TTL_MS (a daily price sync must show up in a long session)', async () => {
  let price = '1.00';
  const fake = install(() => ok([cardRow({ scryfall_id: 'ttl-list', price_usd: price })]));
  const first = await fetchPrintings('Ttl List');
  assert.equal(first.printings[0]!.priceUsd, 1);
  price = '9.00'; // the sync ran

  tick(CACHE_TTL_MS - 1);
  assert.equal((await fetchPrintings('Ttl List')).printings[0]!.priceUsd, 1); // still inside the window
  assert.equal(fake.calls.length, 1);

  tick(1);
  assert.equal(cachedPrintings('Ttl List'), undefined);
  assert.equal((await fetchPrintings('Ttl List')).printings[0]!.priceUsd, 9);
  assert.equal(fake.calls.length, 2);
});

test('fetchPrintings reuses an already-fetched full row rather than downgrading it to a light one', async () => {
  install(() => ok(cardRow({ scryfall_id: 'reuse-1', name: 'Reuse Card', oracle_text: 'Full rules text' })));
  const full = await fetchPrinting('reuse-1');
  assert.equal(full!.full, true);
  install(() => ok([cardRow({ scryfall_id: 'reuse-1', name: 'Reuse Card', oracle_text: null })]));
  const [p] = (await fetchPrintings('Reuse Card')).printings;
  assert.equal(p!.full, true);
  assert.equal(p!.oracleText, 'Full rules text');
});

// ---------------------------------------------------------------------------
// fetchPrinting
// ---------------------------------------------------------------------------

test('fetchPrinting is null with no backend', async () => {
  setBackend(null);
  assert.equal(await fetchPrinting('nobody'), null);
});

test('fetchPrinting reads one row by primary key, in full, and caches it', async () => {
  const fake = install(() => ok(cardRow({ scryfall_id: 'one-1', oracle_text: 'Rules', price_usd: '3' })));
  const p = await fetchPrinting('one-1');
  assert.equal(p!.full, true);
  assert.equal(p!.oracleText, 'Rules');
  assert.equal(p!.priceUsd, 3);
  assert.equal(eqValue(fake.calls[0]!, 'scryfall_id'), 'one-1');
  assert.equal(eqValue(fake.calls[0]!, 'digital'), false);
  assert.equal(cachedPrinting('one-1'), p);
  await fetchPrinting('one-1');
  assert.equal(fake.calls.length, 1);
});

test('fetchPrinting expires a cached row after CACHE_TTL_MS', async () => {
  let price = '1.00';
  const fake = install(() => ok(cardRow({ scryfall_id: 'ttl-row', price_usd: price })));
  assert.equal((await fetchPrinting('ttl-row'))!.priceUsd, 1);
  price = '4.00';
  tick(CACHE_TTL_MS);
  assert.equal(cachedPrinting('ttl-row'), undefined);
  assert.equal((await fetchPrinting('ttl-row'))!.priceUsd, 4);
  assert.equal(fake.calls.length, 2);
});

test('fetchPrinting is null for an error, a missing row and a throw, and caches none of them', async () => {
  install(() => fail('boom'));
  assert.equal(await fetchPrinting('bad-1'), null);
  install(() => ok(null));
  assert.equal(await fetchPrinting('bad-2'), null);
  install(() => { throw new Error('offline'); });
  assert.equal(await fetchPrinting('bad-3'), null);
  for (const id of ['bad-1', 'bad-2', 'bad-3']) assert.equal(cachedPrinting(id), undefined);
});

test('fetchPrinting times out to null', async () => {
  install(() => never());
  const pending = fetchPrinting('slow-1');
  await flush();
  tick(REQUEST_TIMEOUT_MS);
  assert.equal(await pending, null);
});

test('a two-faced card gets one face per side, with each side own art; a one-faced card gets one', async () => {
  install(() => ok(cardRow({
    scryfall_id: 'dfc-1', name: 'Front // Back',
    card_faces: [
      { name: 'Front', mana_cost: '{1}', image_uris: { normal: 'https://img/front.jpg' } },
      { name: 'Back', type_line: 'Land', image_uris: { normal: 'https://img/back.jpg' } },
    ],
  })));
  const dfc = await fetchPrinting('dfc-1');
  assert.deepEqual(dfc!.faces.map(f => [f.name, f.image]), [['Front', 'https://img/front.jpg'], ['Back', 'https://img/back.jpg']]);
  assert.equal(dfc!.faces[1]!.manaCost, null);

  install(() => ok(cardRow({ scryfall_id: 'single-1', card_faces: [{ name: 'Only' }] })));
  const single = await fetchPrinting('single-1');
  assert.equal(single!.faces.length, 1);
  assert.equal(single!.faces[0]!.image, 'https://img/1.jpg'); // the printing's own image, not the lone raw face's missing one
});

// ---------------------------------------------------------------------------
// fetchOwned -- the "Couldn't check your copies" state
// ---------------------------------------------------------------------------

const ownedRow = (over: CardRow = {}): CardRow => ({
  id: 'inst-1', quantity: 2, card_id: 'card-1', card_set_code: 'tst', card_collector_number: '1', finish: 'foil', condition: 'NM', language: 'en', location_id: null, location_name: 'Trade binder', location_type: null, notes: null, ...over,
});

test('fetchOwned with no backend is an empty answer, not an error', async () => {
  setBackend(null);
  assert.deepEqual(await fetchOwned('u1', 'Card'), { stacks: [], error: null });
});

test('fetchOwned scopes on the owner explicitly and on the card name', async () => {
  const fake = install(() => ok([]));
  await fetchOwned('user-7', 'Sol Ring');
  const call = fake.calls[0]!;
  assert.equal(call.table, 'collection_entries');
  assert.equal(eqValue(call, 'owner_user_id'), 'user-7'); // constraint 3: RLS alone would also return a friend's tradable binder
  assert.equal(eqValue(call, 'card_name'), 'Sol Ring');
});

test('fetchOwned maps rows, and an unsorted copy has a null location name', async () => {
  install(() => ok([ownedRow(), ownedRow({ id: 'inst-2', location_name: null, quantity: 1, finish: 'nonfoil' })]));
  const r = await fetchOwned('u1', 'Card');
  assert.equal(r.error, null);
  assert.deepEqual(r.stacks[0], { id: 'inst-1', quantity: 2, setCode: 'tst', collectorNumber: '1', finish: 'foil', condition: 'NM', locationName: 'Trade binder', cardId: 'card-1', language: 'en', locationId: null, locationType: null, notes: null });
  assert.equal(r.stacks[1]!.locationName, null);
});

test('fetchOwned distinguishes "you own none" (no error) from "could not check" (error)', async () => {
  install(() => ok([]));
  const none = await fetchOwned('u1', 'Card');
  assert.deepEqual(none, { stacks: [], error: null });

  install(() => fail('JWT expired', 'PGRST301'));
  const failed = await fetchOwned('u1', 'Card');
  assert.deepEqual(failed.stacks, []);
  assert.equal(failed.error, LOAD_FAILED);
  assert.doesNotMatch(failed.error ?? '', /JWT/);
});

test('fetchOwned reports a throw and a timeout as the same could-not-check error', async () => {
  install(() => { throw new Error('network down'); });
  assert.equal((await fetchOwned('u1', 'Card')).error, LOAD_FAILED);

  install(() => never());
  const pending = fetchOwned('u1', 'Card');
  await flush();
  tick(REQUEST_TIMEOUT_MS);
  const r = await pending;
  assert.equal(r.error, LOAD_FAILED);
  assert.deepEqual(r.stacks, []);
});

// ---------------------------------------------------------------------------
// fetchWantedQuantity / fetchWantList / supply counts
// ---------------------------------------------------------------------------

test('fetchWantedQuantity is 0 without a query when there are no printing ids', async () => {
  const fake = install(() => ok([]));
  assert.equal(await fetchWantedQuantity('u1', []), 0);
  assert.equal(fake.calls.length, 0);
});

test('fetchWantedQuantity sums across printings for this user only', async () => {
  const fake = install(() => ok([{ quantity: 2 }, { quantity: 3 }]));
  assert.equal(await fetchWantedQuantity('u9', ['a', 'b']), 5);
  assert.equal(eqValue(fake.calls[0]!, 'user_id'), 'u9');
});

test('fetchWantList scopes on the user, skips a row whose card is gone, and coerces the price', async () => {
  const fake = install(() => ok([
    { id: 'w1', card_id: 'c1', quantity: 2, cards: { oracle_id: 'o1', name: 'Bolt', set_code: 'lea', collector_number: '161', image_uri_small: null, price_usd: '350.5' } },
    { id: 'w2', card_id: 'c2', quantity: 1, cards: null },
    { id: 'w3', card_id: 'c3', quantity: 1, cards: { oracle_id: 'o3', name: 'Odd', set_code: 'x', collector_number: '1', image_uri_small: null, price_usd: 'oops' } },
  ]));
  const list = await fetchWantList('u3');
  assert.equal(eqValue(fake.calls[0]!, 'user_id'), 'u3');
  assert.deepEqual(list.map(w => [w.id, w.priceUsd]), [['w1', 350.5], ['w3', null]]);
});

test('fetchWantList throws on an error reply (the dashboard relies on this to hide the section)', async () => {
  install(() => fail('nope'));
  await assert.rejects(fetchWantList('u3'), /nope/);
});

test('fetchFriendSupplyCounts counts distinct friends per oracle id, never the caller', async () => {
  const fake = install(() => ok([
    { owner_user_id: 'f1', cards: { oracle_id: 'o1' } },
    { owner_user_id: 'f1', cards: { oracle_id: 'o1' } }, // same friend, two stacks: still one friend
    { owner_user_id: 'f2', cards: { oracle_id: 'o1' } },
    { owner_user_id: 'f2', cards: { oracle_id: 'o2' } },
  ]));
  const counts = await fetchFriendSupplyCounts('me', ['o1', 'o2']);
  assert.deepEqual([...counts], [['o1', 2], ['o2', 1]]);
  assert.deepEqual(fake.calls[0]!.ops.find(o => o.method === 'neq')!.args, ['owner_user_id', 'me']);
});

test('fetchFriendSupplyCounts makes no query for an empty list', async () => {
  const fake = install(() => ok([]));
  assert.equal((await fetchFriendSupplyCounts('me', [])).size, 0);
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// fetchFriendActivity
// ---------------------------------------------------------------------------

test('fetchFriendActivity is empty, with no query, when there are no printing ids', async () => {
  const fake = install(() => ok([]));
  assert.deepEqual(await fetchFriendActivity('me', [], null), { haveForTrade: [], want: [] });
  assert.equal(fake.calls.length, 0);
});

test('fetchFriendActivity is empty, and looks up no names, when nobody has or wants the card', async () => {
  const fake = install(() => ok([]));
  assert.deepEqual(await fetchFriendActivity('me', ['p1'], 'p1'), { haveForTrade: [], want: [] });
  assert.equal(fake.callsTo('profiles').length, 0);
});

test('fetchFriendActivity totals per friend, flags a same-printing copy, excludes the caller, and sorts by name', async () => {
  const fake = install(call => {
    if (call.table === 'card_instances') return ok([
      { owner_user_id: 'f-zed', quantity: 1, card_id: 'other' },
      { owner_user_id: 'f-amy', quantity: 2, card_id: 'other' },
      { owner_user_id: 'f-amy', quantity: 1, card_id: 'sel' },
    ]);
    if (call.table === 'want_list') return ok([{ user_id: 'f-zed', quantity: 4 }, { user_id: 'f-zed', quantity: 1 }]);
    return ok([{ id: 'f-amy', username: 'amy' }, { id: 'f-zed', username: 'zed' }]);
  });
  const r = await fetchFriendActivity('me', ['sel', 'other'], 'sel');
  assert.deepEqual(r.haveForTrade, [
    { userId: 'f-amy', username: 'amy', quantity: 3, samePrinting: true },
    { userId: 'f-zed', username: 'zed', quantity: 1, samePrinting: false },
  ]);
  assert.deepEqual(r.want, [{ userId: 'f-zed', username: 'zed', quantity: 5 }]);
  for (const table of ['card_instances', 'want_list']) {
    const call = fake.callsTo(table)[0]!;
    const neq = call.ops.find(o => o.method === 'neq')!;
    assert.equal(neq.args[1], 'me');
  }
});

test('fetchFriendActivity calls a friend with no profile row "a friend" rather than failing', async () => {
  install(call => {
    if (call.table === 'want_list') return ok([{ user_id: 'ghost', quantity: 1 }]);
    if (call.table === 'card_instances') return ok([]);
    return ok([]);
  });
  const r = await fetchFriendActivity('me', ['p1'], null);
  assert.equal(r.want[0]!.username, 'a friend');
});

// ---------------------------------------------------------------------------
// fetchScryfallExtras -- Scryfall's own API, at the moment someone asks
// ---------------------------------------------------------------------------

type FetchArgs = { url: string; headers: unknown };
const stubFetch = (respond: (url: string) => { ok: boolean; json?: unknown } | Promise<{ ok: boolean; json?: unknown }>): { calls: FetchArgs[]; restore: () => void } => {
  const calls: FetchArgs[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { headers?: unknown }) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers });
    const r = await respond(url);
    return { ok: r.ok, json: async () => r.json } as unknown as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
};

test('fetchScryfallExtras keeps only known formats with known verdicts, and maps rulings', async () => {
  const s = stubFetch(url => url.endsWith('/rulings')
    ? { ok: true, json: { data: [{ published_at: '2020-01-01', comment: 'A ruling.' }] } }
    : { ok: true, json: { legalities: { modern: 'legal', standard: 'not_legal', commander: 'banned', vintage: 'restricted', pauper: 'weird', oldschool: 'legal' } } });
  try {
    const r = await fetchScryfallExtras('abc');
    assert.deepEqual(r.legalities, { modern: 'legal', standard: 'not_legal', commander: 'banned', vintage: 'restricted' });
    assert.deepEqual(r.rulings, [{ date: '2020-01-01', comment: 'A ruling.' }]);
    assert.deepEqual(s.calls.map(c => c.url), ['https://api.scryfall.com/cards/abc', 'https://api.scryfall.com/cards/abc/rulings']);
    assert.match(JSON.stringify(s.calls[0]!.headers), /User-Agent/); // Scryfall asks for both headers
  } finally { s.restore(); }
});

test('fetchScryfallExtras throws when the card cannot be reached, but tolerates a failed rulings call', async () => {
  let s = stubFetch(() => ({ ok: false }));
  try { await assert.rejects(fetchScryfallExtras('abc'), /Scryfall could not be reached/); } finally { s.restore(); }

  s = stubFetch(url => url.endsWith('/rulings') ? { ok: false } : { ok: true, json: { legalities: { modern: 'legal' } } });
  try {
    const r = await fetchScryfallExtras('abc');
    assert.deepEqual(r.rulings, []);
    assert.equal(r.legalities.modern, 'legal');
  } finally { s.restore(); }
});

test('fetchScryfallExtras is bounded by the same deadline', async () => {
  const s = stubFetch(() => new Promise<{ ok: boolean }>(() => {}));
  try {
    const pending = fetchScryfallExtras('abc');
    const settled = assert.rejects(pending, /Timed out/);
    await flush();
    tick(REQUEST_TIMEOUT_MS);
    await settled;
  } finally { s.restore(); }
});
