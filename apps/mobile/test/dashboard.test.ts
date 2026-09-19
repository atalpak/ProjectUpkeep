/**
 * Tests for src/dashboard.ts -- the Dashboard's numbers.
 *
 * The bucketing, the value maths and the wish-match de-duplication all live
 * inside `fetchDashboard`, so the tests drive it through a recording fake
 * backend (helpers/fake-backend.ts) and check both the arithmetic and what the
 * queries asked for: every read of the user's own rows must name the owner
 * (CLAUDE.md constraint 3) and page on a stable order, or the totals drift.
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import { FakeBackend, eqValue, fail, ok, reported, setBackend, type Call, type Reply } from './helpers/fake-backend';
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionAuthError } from '../src/collection';
import { COLOUR_BUCKETS, fetchDashboard } from '../src/dashboard';

type Overrides = {
  entries?: (call: Call) => Reply;
  recent?: Reply;
  wants?: Reply | (() => Reply);
  supply?: Reply | (() => Reply);
  trades?: Reply;
};

const entry = (over: Record<string, unknown> = {}) => ({
  quantity: 1, finish: 'nonfoil', location_id: 'loc-1', card_id: 'card-1', card_name: 'Card', card_colors: [] as string[] | null,
  card_price_usd: null, card_price_usd_foil: null, card_price_usd_etched: null, ...over,
});

/** Answers each of fetchDashboard's queries by table, telling the paged read from the recent-adds read by `range`. */
function install(o: Overrides = {}): FakeBackend {
  const fake = new FakeBackend(call => {
    const has = (m: string) => call.ops.some(op => op.method === m);
    switch (call.table) {
      case 'collection_entries':
        if (eqValue(call, 'location_type') === 'deck') return ok([]);
        if (has('range')) return (o.entries ?? (() => ok([])))(call);
        return o.recent ?? ok([]);
      case 'locations':
      case 'deck_cards':
        return ok([]);
      case 'want_list': { const w = o.wants ?? ok([]); return typeof w === 'function' ? w() : w; }
      case 'card_instances': { const s = o.supply ?? ok([]); return typeof s === 'function' ? s() : s; }
      case 'trades': return o.trades ?? ok([]);
      default: throw new Error(`unexpected table ${call.table}`);
    }
  });
  setBackend(fake);
  return fake;
}

afterEach(() => { mock.restoreAll(); reported.length = 0; });

test('fetchDashboard with no backend says so', async () => {
  setBackend(null);
  await assert.rejects(fetchDashboard('u1'), /Not connected/);
});

test('totals count every copy, keep unsorted apart, and price by finish', async () => {
  install({ entries: () => ok([
    entry({ quantity: 2, location_id: null, card_colors: ['R'], card_price_usd: '1.50' }), // 2 unsorted, 3.00
    entry({ quantity: 1, finish: 'foil', card_id: 'card-2', card_name: 'Shiny', card_colors: ['W', 'U'], card_price_usd: '1', card_price_usd_foil: '10' }), // 10
    entry({ quantity: 3, card_colors: [], card_id: 'card-3' }), // unpriced
    entry({ quantity: 1, card_colors: ['R'], card_price_usd: '0.25', card_id: 'card-4' }),
  ]) });
  const d = await fetchDashboard('u1');
  assert.equal(d.totalCards, 7);
  assert.equal(d.totalEntries, 4);
  assert.equal(d.unsortedCards, 2);
  assert.equal(d.valueTotal, 13.25);
  assert.equal(d.unpricedEntries, 1);
  assert.deepEqual(d.mostValuable, { name: 'Shiny', cardId: 'card-2', value: 10 });
});

test('colours: one colour is its bucket, two or more is Multicolor, none is Colorless; only non-empty buckets, in W U B R G M C order', async () => {
  install({ entries: () => ok([
    entry({ quantity: 3, card_colors: [] }),
    entry({ quantity: 1, card_colors: null }), // a null colour list is colourless too
    entry({ quantity: 2, card_colors: ['G'] }),
    entry({ quantity: 4, card_colors: ['B', 'R'] }),
    entry({ quantity: 1, card_colors: ['W'] }),
  ]) });
  const d = await fetchDashboard('u1');
  assert.deepEqual(d.colours, [{ bucket: 'W', count: 1 }, { bucket: 'G', count: 2 }, { bucket: 'M', count: 4 }, { bucket: 'C', count: 4 }]);
  assert.deepEqual(COLOUR_BUCKETS, ['W', 'U', 'B', 'R', 'G', 'M', 'C']);
});

test('an empty collection is all zeros, not an error', async () => {
  install();
  const d = await fetchDashboard('u1');
  assert.deepEqual([d.totalCards, d.totalEntries, d.unsortedCards, d.valueTotal, d.unpricedEntries, d.mostValuable, d.colours], [0, 0, 0, 0, 0, null, []]);
});

test('the paged read names the owner and a stable order on every page', async () => {
  const fake = install({ entries: () => ok([]) });
  await fetchDashboard('user-42');
  const paged = fake.callsTo('collection_entries').find(c => c.ops.some(o => o.method === 'range'))!;
  assert.equal(eqValue(paged, 'owner_user_id'), 'user-42'); // a friend's tradable binder is readable through RLS
  assert.deepEqual(paged.ops.find(o => o.method === 'order')!.args, ['id']); // no stable order and paging can skip or repeat rows
  const recent = fake.callsTo('collection_entries').find(c => !c.ops.some(o => o.method === 'range') && eqValue(c, 'location_type') === undefined)!;
  assert.equal(eqValue(recent, 'owner_user_id'), 'user-42');
});

test('a collection past one page is read page by page until a short page, with nothing lost or double counted', async () => {
  const pageOf = (n: number) => Array.from({ length: n }, () => entry());
  const fake = install({ entries: call => {
    const [from] = call.ops.find(o => o.method === 'range')!.args as [number, number];
    return ok(pageOf(from === 0 ? 1000 : from === 1000 ? 1000 : 500));
  } });
  const d = await fetchDashboard('u1');
  assert.equal(d.totalEntries, 2500);
  assert.equal(d.totalCards, 2500);
  const ranges = fake.callsTo('collection_entries').filter(c => c.ops.some(o => o.method === 'range')).map(c => c.ops.find(o => o.method === 'range')!.args);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('an exactly-full page asks for one more, which comes back empty', async () => {
  const fake = install({ entries: call => ok(call.ops.find(o => o.method === 'range')!.args[0] === 0 ? Array.from({ length: 1000 }, () => entry()) : []) });
  const d = await fetchDashboard('u1');
  assert.equal(d.totalEntries, 1000);
  assert.equal(fake.callsTo('collection_entries').filter(c => c.ops.some(o => o.method === 'range')).length, 2);
});

test('a permission failure surfaces as CollectionAuthError, so the app can ask the person to sign in again', async () => {
  for (const code of ['42501', 'PGRST301']) {
    install({ entries: () => fail('JWT expired', code) });
    await assert.rejects(fetchDashboard('u1'), (e: unknown) => e instanceof CollectionAuthError);
  }
});

test('any other database error is a plain Error, not an auth error', async () => {
  install({ entries: () => fail('statement timeout', '57014') });
  await assert.rejects(fetchDashboard('u1'), (e: unknown) => e instanceof Error && !(e instanceof CollectionAuthError) && /statement timeout/.test(e.message));
});

test('recently added maps the rows and a failed read fails the dashboard', async () => {
  install({ recent: ok([{ id: 'e1', card_id: 'c1', card_name: 'Bolt', card_image_uri_small: 'https://img/b.jpg' }, { id: 'e2', card_id: 'c2', card_name: 'Odd', card_image_uri_small: null }]) });
  const d = await fetchDashboard('u1');
  assert.deepEqual(d.recent, [{ id: 'e1', cardId: 'c1', name: 'Bolt', imageSmall: 'https://img/b.jpg' }, { id: 'e2', cardId: 'c2', name: 'Odd', imageSmall: null }]);
  install({ recent: fail('recent broke') });
  await assert.rejects(fetchDashboard('u1'), /recent broke/);
});

// --- wish matches -----------------------------------------------------------

const want = (id: string, oracle: string, name: string) => ({ id, card_id: `card-${id}`, quantity: 1, cards: { oracle_id: oracle, name, set_code: 'x', collector_number: '1', image_uri_small: null, price_usd: null } });

test('wish matches list a wished card once however many printings are wished, and hide cards no friend has', async () => {
  const fake = install({
    wants: ok([want('w1', 'o1', 'Bolt (old)'), want('w2', 'o1', 'Bolt (new)'), want('w3', 'o2', 'Nobody Has This'), want('w4', 'o3', 'Ring')]),
    supply: ok([
      { owner_user_id: 'f1', cards: { oracle_id: 'o1' } }, { owner_user_id: 'f2', cards: { oracle_id: 'o1' } },
      { owner_user_id: 'f1', cards: { oracle_id: 'o3' } },
    ]),
  });
  const d = await fetchDashboard('me');
  assert.deepEqual(d.wishMatches, [{ name: 'Bolt (old)', cardId: 'card-w1', friends: 2 }, { name: 'Ring', cardId: 'card-w4', friends: 1 }]);
  // one supply query for the whole list, for distinct oracle ids only, never counting yourself
  const supply = fake.callsTo('card_instances');
  assert.equal(supply.length, 1);
  assert.deepEqual(supply[0]!.ops.find(o => o.method === 'in')!.args, ['cards.oracle_id', ['o1', 'o2', 'o3']]);
  assert.deepEqual(supply[0]!.ops.find(o => o.method === 'neq')!.args, ['owner_user_id', 'me']);
});

test('a failing friend-supply read hides the section and is reported, but does not fail the dashboard', async () => {
  mock.method(console, 'warn', () => {});
  install({ wants: ok([want('w1', 'o1', 'Bolt')]), supply: () => { throw new Error('supply down'); }, entries: () => ok([entry({ quantity: 2 })]) });
  const d = await fetchDashboard('u1');
  assert.deepEqual(d.wishMatches, []);
  assert.equal(d.totalCards, 2);
  assert.deepEqual(reported.map(r => r.context), ['dashboard.friendSupply']);
});

test('a failing wish-list read hides the section and is reported, but does not fail the dashboard', async () => {
  mock.method(console, 'warn', () => {});
  install({ wants: fail('wants down'), entries: () => ok([entry({ quantity: 3 })]) });
  const d = await fetchDashboard('u1');
  assert.deepEqual(d.wishMatches, []);
  assert.equal(d.totalCards, 3);
  assert.deepEqual(reported.map(r => r.context), ['dashboard.wants']);
});

// --- trades -----------------------------------------------------------------

test('trades awaiting counts proposals to me that have not expired, and asks for only mine', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const fake = install({ trades: ok([
    { recipient_id: 'me', expires_at: future, status: 'proposed' },
    { recipient_id: 'me', expires_at: null, status: 'proposed' }, // never expires
    { recipient_id: 'me', expires_at: past, status: 'proposed' }, // lapsed
    { recipient_id: 'someone-else', expires_at: null, status: 'proposed' }, // not mine, even if a policy let it through
  ]) });
  const d = await fetchDashboard('me');
  assert.equal(d.tradesAwaiting, 2);
  const call = fake.callsTo('trades')[0]!;
  assert.equal(eqValue(call, 'recipient_id'), 'me');
  assert.equal(eqValue(call, 'status'), 'proposed');
});
