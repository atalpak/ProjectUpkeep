/**
 * Decklist entry states.
 *
 * The rule the whole deck page turns on: is this entry done, could I finish it
 * from my binder, or do I need to go and get one?
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countsFor,
  deckProgress,
  entryState,
  type EntryState,
} from "../src/lib/collection/deck-state";

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
