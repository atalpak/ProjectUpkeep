/**
 * Checking a list you have not committed to.
 *
 * The distinction this screen exists for: "you own it, it is just sleeved into
 * another deck" is a different answer from "you do not own it", and the deck
 * page cannot tell them apart.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkEntry,
  countsFrom,
  describeElsewhere,
  describeSpare,
  foldByCard,
  summarize,
  type CheckCard,
  type CheckedEntry,
} from "../src/lib/collection/list-check";

const card = (over: Partial<CheckCard> = {}): CheckCard => ({
  scryfall_id: "print-1",
  oracle_id: "oracle-bolt",
  name: "Lightning Bolt",
  flavor_name: null,
  set_code: "lea",
  collector_number: "161",
  type_line: "Instant",
  mana_cost: "{R}",
  cmc: 1,
  rarity: "common",
  colors: ["R"],
  image_uri_small: null,
  price_usd: null,
  ...over,
});

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

test("enough free copies is ready", () => {
  const e = checkEntry({ wanted: 4, free: 4, inDecks: 0 });
  assert.equal(e.state, "ready");
  assert.equal(e.fromFree, 4);
  assert.equal(e.fromDecks, 0);
  assert.equal(e.short, 0);
});

test("spare free copies beyond what the list wants stay ready", () => {
  const e = checkEntry({ wanted: 1, free: 9, inDecks: 3 });
  assert.equal(e.state, "ready");
  assert.equal(e.fromFree, 1, "only what the list asks for is claimed");
  assert.equal(e.fromDecks, 0, "a deck is never raided while free copies remain");
});

test("owned but sleeved into another deck is 'elsewhere', not missing", () => {
  const e = checkEntry({ wanted: 1, free: 0, inDecks: 1 });
  assert.equal(e.state, "elsewhere");
  assert.equal(e.fromDecks, 1);
  assert.equal(e.short, 0);
});

test("owning none of it is missing", () => {
  const e = checkEntry({ wanted: 2, free: 0, inDecks: 0 });
  assert.equal(e.state, "missing");
  assert.equal(e.short, 2);
});

test("free copies are spent before deck copies", () => {
  const e = checkEntry({ wanted: 4, free: 1, inDecks: 2 });
  assert.equal(e.fromFree, 1);
  assert.equal(e.fromDecks, 2);
  assert.equal(e.short, 1);
  assert.equal(e.state, "missing", "a shortfall outranks a raidable deck copy");
});

test("a partly-covered entry with no shortfall is elsewhere", () => {
  const e = checkEntry({ wanted: 4, free: 3, inDecks: 1 });
  assert.equal(e.state, "elsewhere");
  assert.equal(e.short, 0);
});

test("countsFrom reads an availability row the way the map stores it", () => {
  const e = countsFrom(4, { total: 5, inDecks: 3, available: 2 });
  assert.equal(e.free, 2);
  assert.equal(e.inDecks, 3);
  assert.equal(e.fromFree, 2);
  assert.equal(e.fromDecks, 2);
  assert.equal(e.state, "elsewhere");
});

// ---------------------------------------------------------------------------
// Naming where a copy would come from
// ---------------------------------------------------------------------------

test("describeSpare says nothing when nothing is free", () => {
  assert.equal(describeSpare(0, []), "");
  assert.equal(describeSpare(0, ["Box 3"]), "", "a stale location list with no free copies is not shown");
});

test("describeSpare names the container once known", () => {
  assert.equal(describeSpare(3, []), "3 free");
  assert.equal(describeSpare(3, ["Box 3"]), "3 free (Box 3)");
});

test("describeSpare lists every container a free copy sits in", () => {
  assert.equal(describeSpare(2, ["Binder A", "Box 3"]), "2 free (Binder A, Box 3)");
});

test("describeElsewhere says nothing when nothing is sleeved elsewhere", () => {
  assert.equal(describeElsewhere(0, []), "");
  assert.equal(describeElsewhere(0, ["Mono-Red Aggro"]), "");
});

test("describeElsewhere names the one deck it is in", () => {
  assert.equal(describeElsewhere(1, ["Mono-Red Aggro"]), "1 in Mono-Red Aggro");
});

test("describeElsewhere collapses to a count across several decks", () => {
  assert.equal(
    describeElsewhere(2, ["Mono-Red Aggro", "Boros Convoke"]),
    "2 in 2 other decks",
  );
});

test("describeElsewhere falls back to 'another deck' if no name is known", () => {
  // Belt-and-braces: fromDecks and deck names come from two different reads,
  // so a caller that forgets to wire one through should not read as "in ".
  assert.equal(describeElsewhere(1, []), "1 in another deck");
});

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

test("two printings of the same card fold into one entry", () => {
  const entries = foldByCard([
    { line: 1, quantity: 14, card: card({ scryfall_id: "a", oracle_id: "oracle-forest" }) },
    { line: 2, quantity: 6, card: card({ scryfall_id: "b", oracle_id: "oracle-forest" }) },
  ]);

  assert.equal(entries.length, 1, "one card, not two printings");
  assert.equal(entries[0].wanted, 20);
  assert.equal(entries[0].printings, 2);
  assert.equal(entries[0].line, 1, "keeps the first line it appeared on");
  assert.equal(entries[0].card.scryfall_id, "a", "keeps the first printing's art");
});

test("folding by card is what stops the collection being counted twice", () => {
  // 20 Forests owned, all free. A list asking for 14 of one art and 6 of
  // another is asking for 20 Forests, and is exactly buildable — not two
  // separate entries that each see "20 free" and both report ready.
  const entries = foldByCard([
    { line: 1, quantity: 14, card: card({ scryfall_id: "a", oracle_id: "oracle-forest" }) },
    { line: 2, quantity: 6, card: card({ scryfall_id: "b", oracle_id: "oracle-forest" }) },
  ]);
  const checked = entries.map((e) => countsFrom(e.wanted, { total: 20, inDecks: 0, available: 20 }));

  assert.equal(checked.length, 1);
  assert.equal(checked[0].wanted, 20);
  assert.equal(checked[0].state, "ready");
});

test("different cards stay separate", () => {
  const entries = foldByCard([
    { line: 1, quantity: 1, card: card({ oracle_id: "oracle-bolt" }) },
    { line: 2, quantity: 1, card: card({ scryfall_id: "z", oracle_id: "oracle-ring", name: "Sol Ring" }) },
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.card.name),
    ["Lightning Bolt", "Sol Ring"],
    "and keep the order they were pasted in",
  );
});

test("cards with no oracle id fold on name instead", () => {
  const entries = foldByCard([
    { line: 1, quantity: 1, card: card({ scryfall_id: "a", oracle_id: null }) },
    { line: 2, quantity: 2, card: card({ scryfall_id: "b", oracle_id: null }) },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].wanted, 3);
});

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

const checked = (counts: Array<[number, number, number]>): CheckedEntry[] =>
  counts.map(([wanted, free, inDecks]) => checkEntry({ wanted, free, inDecks }));

test("the summary counts cards, not entries", () => {
  const s = summarize(checked([
    [4, 4, 0], // ready
    [2, 0, 2], // elsewhere
    [3, 1, 0], // 1 free, 2 short
  ]));

  assert.equal(s.entries, 3);
  assert.equal(s.wanted, 9);
  assert.equal(s.free, 5);
  assert.equal(s.inDecks, 2);
  assert.equal(s.missing, 2);
  assert.equal(s.free + s.inDecks + s.missing, s.wanted, "every wanted copy is accounted for once");
});

test("entry counts split by state", () => {
  const s = summarize(checked([[1, 1, 0], [1, 0, 1], [1, 0, 0], [1, 0, 0]]));
  assert.equal(s.readyEntries, 1);
  assert.equal(s.elsewhereEntries, 1);
  assert.equal(s.missingEntries, 2);
});

test("buildable means no deck has to be taken apart", () => {
  assert.equal(summarize(checked([[4, 4, 0], [1, 1, 0]])).buildable, true);
  assert.equal(
    summarize(checked([[4, 4, 0], [1, 0, 1]])).buildable,
    false,
    "a copy sitting in another deck is not free",
  );
  assert.equal(summarize(checked([[1, 0, 0]])).buildable, false);
});

test("an empty list is not buildable", () => {
  assert.equal(summarize([]).buildable, false);
  assert.equal(summarize([]).wanted, 0);
});
