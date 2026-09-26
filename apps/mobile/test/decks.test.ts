/**
 * Tests for the pure and near-pure parts of src/decks.ts: the deck tile
 * arithmetic (how much of a list is physically sleeved), the small formatting
 * helpers, and the deck-management writes' validation and scoping. The
 * sleeve/unsleeve queries are not covered here.
 *
 * Run with: npm test -w @upkeep/scanner-app
 */

import { FakeBackend, eqValue, fail, ok, setBackend, type Call, type Reply } from './helpers/fake-backend';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionAuthError } from '../src/collection';
import {
  DECK_FORMAT_MAX, DECK_NAME_MAX, DECK_NOTES_MAX, DECK_TAGS_MAX, DECK_TAG_MAX, artCropUrl, deleteDeck, entryKey, fetchDeckTiles, normalizeTags,
  renameDeck, setDeckPublic, updateDeckDetails,
} from '../src/decks';

const install = (respond: (call: Call) => Reply | Promise<Reply>): FakeBackend => {
  const fake = new FakeBackend(respond);
  setBackend(fake);
  return fake;
};
const opArgs = (call: Call, method: string): unknown[] => call.ops.find(o => o.method === method)!.args;

// --- helpers ----------------------------------------------------------------

test('artCropUrl swaps the size segment for art_crop on every front-face size, and passes null through', () => {
  for (const size of ['small', 'normal', 'large']) {
    assert.equal(artCropUrl(`https://cards.scryfall.io/${size}/front/a/b/abc.jpg?1`), 'https://cards.scryfall.io/art_crop/front/a/b/abc.jpg?1');
  }
  assert.equal(artCropUrl(null), null);
  assert.equal(artCropUrl(''), null);
  assert.equal(artCropUrl('https://cards.scryfall.io/art_crop/front/a/b/abc.jpg'), 'https://cards.scryfall.io/art_crop/front/a/b/abc.jpg');
});

test('entryKey matches on oracle id so any printing counts, and falls back to the lower-cased name', () => {
  assert.equal(entryKey({ oracleId: 'o1', name: 'Bolt' }), entryKey({ oracleId: 'o1', name: 'Bolt (showcase)' }));
  assert.notEqual(entryKey({ oracleId: 'o1', name: 'Bolt' }), entryKey({ oracleId: 'o2', name: 'Bolt' }));
  assert.equal(entryKey({ oracleId: null, name: 'Sol RING' }), entryKey({ oracleId: null, name: 'sol ring' }));
});

test('normalizeTags trims, clamps, drops blanks and case-insensitive duplicates (first spelling wins)', () => {
  assert.deepEqual(normalizeTags(['  Budget ', 'budget', '', '   ', 'Tribal', 'TRIBAL', 'Elves']), ['Budget', 'Tribal', 'Elves']);
  const long = 'x'.repeat(DECK_TAG_MAX + 10);
  assert.equal(normalizeTags([long])[0]!.length, DECK_TAG_MAX);
});

test('normalizeTags stops at the tag limit', () => {
  const many = Array.from({ length: DECK_TAGS_MAX + 5 }, (_, i) => `tag${i}`);
  const out = normalizeTags(many);
  assert.equal(out.length, DECK_TAGS_MAX);
  assert.equal(out[DECK_TAGS_MAX - 1], `tag${DECK_TAGS_MAX - 1}`);
});

test('two tags that clamp to the same text are one tag', () => {
  const base = 'y'.repeat(DECK_TAG_MAX);
  assert.deepEqual(normalizeTags([`${base}AAA`, `${base}BBB`]), [base]);
});

// --- fetchDeckTiles ---------------------------------------------------------

const tileResponder = (over: { decks?: Reply; list?: Reply; sleeved?: Reply; cards?: Reply } = {}) => (call: Call): Reply => {
  if (call.table === 'locations') return over.decks ?? ok([]);
  if (call.table === 'deck_cards') return over.list ?? ok([]);
  if (call.table === 'collection_entries') return over.sleeved ?? ok([]);
  if (call.table === 'cards') return over.cards ?? ok([]);
  throw new Error(`unexpected table ${call.table}`);
};

test('deck tiles: sleeved counts per list entry, capped at what the entry asks for, and any printing counts', async () => {
  install(tileResponder({
    decks: ok([
      { id: 'd1', name: 'Burn', format: 'Modern', is_public: true, commander_card_id: null },
      { id: 'd2', name: 'Empty', format: null, is_public: null, commander_card_id: null },
    ]),
    list: ok([
      { deck_id: 'd1', quantity: 4, cards: { name: 'Bolt', oracle_id: 'o1' } },
      { deck_id: 'd1', quantity: 1, cards: { name: 'Sol Ring', oracle_id: 'o2' } },
    ]),
    sleeved: ok([
      { location_id: 'd1', quantity: 2, card_oracle_id: 'o1', card_name: 'Bolt' },
      { location_id: 'd1', quantity: 4, card_oracle_id: 'o1', card_name: 'Bolt (other printing)' }, // 6 sleeved of a 4-of: capped at 4
      { location_id: 'd1', quantity: 5, card_oracle_id: 'o9', card_name: 'Not on the list' }, // sleeved but not asked for: counts for nothing
      { location_id: null, quantity: 9, card_oracle_id: 'o2', card_name: 'Sol Ring' }, // not in a deck at all
    ]),
  }));
  const [burn, empty] = await fetchDeckTiles('u1');
  assert.deepEqual([burn!.cardCount, burn!.uniqueCount, burn!.sleevedCount, burn!.isPublic], [5, 2, 4, true]);
  assert.deepEqual([empty!.cardCount, empty!.uniqueCount, empty!.sleevedCount, empty!.isPublic], [0, 0, 0, false]);
});

test('deck tiles: every read is scoped to the user, including the two a friend\'s public deck could leak into', async () => {
  const fake = install(tileResponder());
  await fetchDeckTiles('user-9');
  assert.equal(eqValue(fake.callsTo('locations')[0]!, 'user_id'), 'user-9');
  assert.equal(eqValue(fake.callsTo('deck_cards')[0]!, 'locations.user_id'), 'user-9');
  assert.equal(eqValue(fake.callsTo('collection_entries')[0]!, 'owner_user_id'), 'user-9');
});

test('deck tiles: a commander gives the tile its art crop, colours and name (flavour name in brackets), in one lookup for all decks', async () => {
  const fake = install(tileResponder({
    decks: ok([
      { id: 'd1', name: 'A', format: 'Commander', is_public: false, commander_card_id: 'c1' },
      { id: 'd2', name: 'B', format: 'Commander', is_public: false, commander_card_id: 'c1' },
      { id: 'd3', name: 'C', format: 'Commander', is_public: false, commander_card_id: 'missing' },
    ]),
    cards: ok([{ scryfall_id: 'c1', name: 'Real Name', flavor_name: 'Flavor Name', image_uri: 'https://cards.scryfall.io/normal/front/1/2/x.jpg', color_identity: ['G', 'W'] }]),
  }));
  const [a, , c] = await fetchDeckTiles('u1');
  assert.equal(a!.commanderName, 'Real Name (Flavor Name)');
  assert.equal(a!.commanderArt, 'https://cards.scryfall.io/art_crop/front/1/2/x.jpg');
  assert.deepEqual(a!.commanderColors, ['G', 'W']);
  assert.deepEqual([c!.commanderName, c!.commanderArt, c!.commanderColors], [null, null, []]); // a commander that no longer resolves is just no commander
  assert.equal(fake.callsTo('cards').length, 1);
  assert.deepEqual(opArgs(fake.callsTo('cards')[0]!, 'in'), ['scryfall_id', ['c1', 'missing']]);
});

test('deck tiles: no commanders means no card lookup at all', async () => {
  const fake = install(tileResponder({ decks: ok([{ id: 'd1', name: 'A', format: null, is_public: false, commander_card_id: null }]) }));
  await fetchDeckTiles('u1');
  assert.equal(fake.callsTo('cards').length, 0);
});

test('deck tiles: a permission failure on any of the reads is a CollectionAuthError; other failures are plain errors', async () => {
  install(tileResponder({ sleeved: fail('JWT expired', 'PGRST301') }));
  await assert.rejects(fetchDeckTiles('u1'), (e: unknown) => e instanceof CollectionAuthError);
  install(tileResponder({ list: fail('boom') }));
  await assert.rejects(fetchDeckTiles('u1'), (e: unknown) => e instanceof Error && !(e instanceof CollectionAuthError) && e.message === 'boom');
});

test('deck tiles with no backend say so', async () => {
  setBackend(null);
  await assert.rejects(fetchDeckTiles('u1'), /Not connected/);
});

// --- deck management writes ---------------------------------------------------

const updated = (call: Call) => ok(call.table === 'locations' ? [{ id: 'd1' }] : []);

test('renameDeck rejects a blank or over-long name before any query is made', async () => {
  const fake = install(updated);
  await assert.rejects(renameDeck('u1', 'd1', '   '), /Give the deck a name/);
  await assert.rejects(renameDeck('u1', 'd1', 'x'.repeat(DECK_NAME_MAX + 1)), /too long/);
  assert.equal(fake.calls.length, 0);
});

test('renameDeck writes the trimmed name, scoped to this user, this deck, and decks only', async () => {
  const fake = install(updated);
  await renameDeck('user-1', 'deck-1', '  Goblins  ');
  const call = fake.calls[0]!;
  assert.deepEqual(opArgs(call, 'update'), [{ name: 'Goblins' }]);
  assert.equal(eqValue(call, 'id'), 'deck-1');
  assert.equal(eqValue(call, 'user_id'), 'user-1'); // a friend's public deck row is readable, so "mine" has to be stated
  assert.equal(eqValue(call, 'type'), 'deck');
});

test('a write that matched nothing is an error the person can read, not a silent success', async () => {
  install(() => ok([]));
  await assert.rejects(renameDeck('u1', 'gone', 'Name'), /could not be found, or is no longer yours/);
  await assert.rejects(setDeckPublic('u1', 'gone', true), /could not be found/);
  await assert.rejects(deleteDeck('u1', 'gone'), /could not be found/);
});

test('a duplicate deck name becomes a friendly sentence; other errors pass through', async () => {
  install(() => fail('duplicate key value violates unique constraint "locations_user_name_key"'));
  await assert.rejects(renameDeck('u1', 'd1', 'Dup'), /You already have a deck called that\./);
  install(() => fail('something else'));
  await assert.rejects(renameDeck('u1', 'd1', 'Name'), /^Error: something else$/);
});

test('updateDeckDetails enforces the format and notes limits before writing', async () => {
  const fake = install(updated);
  await assert.rejects(updateDeckDetails('u1', 'd1', { name: 'N', format: 'f'.repeat(DECK_FORMAT_MAX + 1), tags: [], notes: '' }), /format name is too long/);
  await assert.rejects(updateDeckDetails('u1', 'd1', { name: 'N', format: '', tags: [], notes: 'n'.repeat(DECK_NOTES_MAX + 1) }), /notes are too long/);
  await assert.rejects(updateDeckDetails('u1', 'd1', { name: '', format: '', tags: [], notes: '' }), /Give the deck a name/);
  assert.equal(fake.calls.length, 0);
});

test('updateDeckDetails stores blank format and notes as null, keeps notes as typed, and normalizes tags', async () => {
  const fake = install(updated);
  await updateDeckDetails('u1', 'd1', { name: ' Elves ', format: '  ', tags: ['Tribal', 'tribal', ' '], notes: '   ' });
  assert.deepEqual(opArgs(fake.calls[0]!, 'update'), [{ name: 'Elves', format: null, notes: null, tags: ['Tribal'] }]);
  await updateDeckDetails('u1', 'd1', { name: 'Elves', format: ' Commander ', tags: [], notes: '  keep my spacing  ' });
  assert.deepEqual(opArgs(fake.calls[1]!, 'update'), [{ name: 'Elves', format: 'Commander', notes: '  keep my spacing  ', tags: [] }]);
});

test('setDeckPublic and deleteDeck are scoped to the signed-in user', async () => {
  const fake = install(updated);
  await setDeckPublic('user-5', 'deck-5', true);
  assert.deepEqual(opArgs(fake.calls[0]!, 'update'), [{ is_public: true }]);
  assert.equal(eqValue(fake.calls[0]!, 'user_id'), 'user-5');
  await deleteDeck('user-5', 'deck-5');
  assert.equal(fake.calls[1]!.ops[0]!.method, 'delete');
  assert.equal(eqValue(fake.calls[1]!, 'user_id'), 'user-5');
  assert.equal(eqValue(fake.calls[1]!, 'type'), 'deck');
});
