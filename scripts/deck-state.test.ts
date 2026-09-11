/**
 * Decklist entry states.
 *
 * The rule the whole deck page turns on: is this entry done, could I finish it
 * from my binder, or do I need to go and get one?
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countAvailableAcrossDecks,
  countsFor,
  deckProgress,
  entryState,
  type DeckEntryRow,
  type EntryState,
} from "../src/lib/collection/deck-state";
import type { Availability } from "../src/lib/collection/availability";

const availability = (available: number, total = available, inDecks = total - available) => ({
  total,
  inDecks,
  available,
});

test("an entry with everything sleeved is done", () => {
  const s = entryState({ wanted: 4, sleeved: 4, available: 0 });
  assert.equal(s.state, "sleeved");
  assert.equal(s.outstanding, 0);
  assert.equal(s.sleevable, 0);
});

test("more sleeved than asked for still counts as done", () => {
  const s = entryState({ wanted: 1, sleeved: 3, available: 0 });
  assert.equal(s.state, "sleeved");
  assert.equal(s.outstanding, 0, "outstanding never goes negative");
});

test("nothing sleeved but copies in the binder is available", () => {
  const s = entryState({ wanted: 4, sleeved: 0, available: 4 });
  assert.equal(s.state, "available");
  assert.equal(s.outstanding, 4);
  assert.equal(s.sleevable, 4);
});

test("nothing sleeved and nothing spare is missing", () => {
  const s = entryState({ wanted: 4, sleeved: 0, available: 0 });
  assert.equal(s.state, "missing");
  assert.equal(s.sleevable, 0);
});

test("a partly sleeved entry reports the state of what is left", () => {
  const canFinish = entryState({ wanted: 4, sleeved: 3, available: 1 });
  assert.equal(canFinish.state, "available", "the fourth is in a binder");
  assert.equal(canFinish.outstanding, 1);
  assert.equal(canFinish.sleevable, 1);

  const cannotFinish = entryState({ wanted: 4, sleeved: 3, available: 0 });
  assert.equal(cannotFinish.state, "missing", "the fourth is not owned");
  assert.equal(cannotFinish.outstanding, 1);
});

test("sleevable never exceeds what is still outstanding", () => {
  const s = entryState({ wanted: 4, sleeved: 3, available: 9 });
  assert.equal(s.outstanding, 1);
  assert.equal(s.sleevable, 1, "owning nine spares does not mean sleeving nine");
});

test("countsFor reads availability as copies outside every deck", () => {
  // Four owned: one sleeved here, three still in a binder.
  const s = countsFor(4, 1, availability(3, 4, 1));
  assert.equal(s.state, "available");
  assert.equal(s.outstanding, 3);
  assert.equal(s.sleevable, 3);
});

test("copies sleeved in a different deck are not available to this one", () => {
  // Four owned, all four sleeved in other decks: nothing free.
  const s = countsFor(4, 0, availability(0, 4, 4));
  assert.equal(s.state, "missing");
  assert.equal(s.available, 0);
});

// ---------------------------------------------------------------------------
// Deck-level progress
// ---------------------------------------------------------------------------

const state = (wanted: number, sleeved: number, available: number): EntryState =>
  entryState({ wanted, sleeved, available });

test("progress sums the list", () => {
  const p = deckProgress([state(4, 4, 0), state(4, 1, 3), state(2, 0, 0)]);
  assert.equal(p.entries, 3);
  assert.equal(p.wanted, 10);
  assert.equal(p.sleeved, 5);
  assert.equal(p.missingEntries, 1);
});

test("progress caps each entry, so it cannot exceed the list", () => {
  const p = deckProgress([state(1, 5, 0)]);
  assert.equal(p.wanted, 1);
  assert.equal(p.sleeved, 1, "five sleeved against a list of one is not 500% done");
});

test("an empty deck has no progress and no missing entries", () => {
  const p = deckProgress([]);
  assert.deepEqual(p, { entries: 0, wanted: 0, sleeved: 0, missingEntries: 0 });
});

// ---------------------------------------------------------------------------
// Cross-deck aggregate: the dashboard's "decks missing cards you own" count
// ---------------------------------------------------------------------------

const sleeved = (rows: Array<[deckId: string, key: string, quantity: number]>) => {
  const map = new Map<string, Map<string, number>>();
  for (const [deckId, key, quantity] of rows) {
    const forDeck = map.get(deckId) ?? new Map<string, number>();
    forDeck.set(key, quantity);
    map.set(deckId, forDeck);
  }
  return map;
};

const avail = (rows: Array<[key: string, available: number]>) =>
  new Map<string, Availability>(
    rows.map(([key, available]) => [key, { total: available, inDecks: 0, available }]),
  );

const entry = (deckId: string, key: string | null, wanted: number): DeckEntryRow => ({
  deckId,
  key,
  wanted,
});

test("counts an entry as available when it is not sleeved but a spare exists", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1)],
    sleeved([]),
    avail([["bolt", 1]]),
  );
  assert.equal(count, 1);
});

test("does not count an entry that is already fully sleeved", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1)],
    sleeved([["deck-a", "bolt", 1]]),
    avail([["bolt", 1]]),
  );
  assert.equal(count, 0);
});

test("does not count an entry with no spare copies anywhere", () => {
  const count = countAvailableAcrossDecks([entry("deck-a", "bolt", 1)], sleeved([]), avail([]));
  assert.equal(count, 0);
});

test("what's sleeved in one deck does not count toward a different deck's entry", () => {
  // Same card wanted in two decks; the only copy is sleeved in deck-a, which
  // is exactly why availability (collection-wide, computed independently of
  // any one deck) already reports zero free — deck-b's entry is missing, not
  // available, because there is nothing spare left to pull in.
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1), entry("deck-b", "bolt", 1)],
    sleeved([["deck-a", "bolt", 1]]),
    avail([["bolt", 0]]),
  );
  assert.equal(count, 0);
});

test("sums across every deck, not just one", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1), entry("deck-b", "path", 1), entry("deck-c", "shock", 1)],
    sleeved([["deck-c", "shock", 1]]),
    avail([
      ["bolt", 1],
      ["path", 1],
    ]),
  );
  assert.equal(count, 2, "bolt and path are available; shock is already sleeved in deck-c");
});

test("a row with no card to key on is skipped rather than counted", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", null, 1)],
    sleeved([]),
    avail([]),
  );
  assert.equal(count, 0);
});

// ---------------------------------------------------------------------------
// A scarce shared spare must not be counted twice
//
// availability.get(key).available is a *global* number, with no notion of how
// many decks are simultaneously short the same card. Checking each entry
// against it independently double-counted: two unsleeved entries for the same
// card, sharing one spare, used to read as two "available" entries when only
// one deck could actually be filled.
// ---------------------------------------------------------------------------

test("two decks short the same card, one shared spare, counts once — not twice", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1), entry("deck-b", "bolt", 1)],
    sleeved([]),
    avail([["bolt", 1]]),
  );
  assert.equal(count, 1, "one spare Bolt cannot fill two decks at once");
});

test("two decks short the same card with two spares counts as two, not floored to one", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1), entry("deck-b", "bolt", 1)],
    sleeved([]),
    avail([["bolt", 2]]),
  );
  assert.equal(count, 2, "two spares really can fill both decks");
});

test("three decks short the same card with one spare still counts once", () => {
  const count = countAvailableAcrossDecks(
    [entry("deck-a", "bolt", 1), entry("deck-b", "bolt", 1), entry("deck-c", "bolt", 1)],
    sleeved([]),
    avail([["bolt", 1]]),
  );
  assert.equal(count, 1, "one spare Bolt cannot fill three decks either");
});
