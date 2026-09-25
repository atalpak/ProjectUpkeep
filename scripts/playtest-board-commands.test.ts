/**
 * The v2 command set (board/commands.ts, board/reducers/*): each command does
 * exactly what it says, refuses what it should, and returns the SAME state
 * reference when it changes nothing (the store relies on that to skip an empty
 * undo step). The invariants (board/invariants.ts) are asserted after every
 * command here too, not only in the property test, so a failure names the
 * command that broke them.
 *
 * Run with: npx tsx --test scripts/playtest-board-commands.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { emptyHistory, record, undo } from "../src/lib/playtest/board/history";
import { checkInvariants } from "../src/lib/playtest/board/invariants";
import { fixtureSixtyCardStart, makeGameCard, makeState } from "../src/lib/playtest/board/fixtures";
import type { GameCommand } from "../src/lib/playtest/board/commands";
import type { GameState } from "../src/lib/playtest/board/types";

function run(state: GameState, command: GameCommand): GameState {
  const next = applyCommand(state, command);
  assert.deepEqual(checkInvariants(next), [], `invariants broken by ${command.type}`);
  return next;
}

const ids = (state: GameState, n: number, from = 0) => state.zones.library.slice(from, from + n);

test("MOVE_MANY moves several cards as one step, preserving the order given", () => {
  const state = fixtureSixtyCardStart();
  const [a, b, c] = ids(state, 3);
  const next = run(state, { type: "MOVE_MANY", ids: [c, a, b], to: "hand", at: "bottom" });
  assert.deepEqual(next.zones.hand, [c, a, b]);
  assert.equal(next.zones.library.length, 57);
  assert.equal(next.events.length, 1, "one gesture, one event");
  assert.equal(next.events[0].ids.length, 3);
});

test("MOVE_MANY inserts at top, bottom or an exact clamped index", () => {
  const state = fixtureSixtyCardStart();
  const hand = run(state, { type: "DRAW", count: 3 });
  const [x, y, z] = hand.zones.hand;
  assert.deepEqual(run(hand, { type: "MOVE_MANY", ids: [x], to: "library", at: "top" }).zones.library.slice(0, 2), [x, state.zones.library[3]]);
  assert.equal(run(hand, { type: "MOVE_MANY", ids: [x], to: "library", at: "bottom" }).zones.library.at(-1), x);
  assert.equal(run(hand, { type: "MOVE_MANY", ids: [y, z], to: "library", at: 5 }).zones.library[5], y);
  assert.equal(run(hand, { type: "MOVE_MANY", ids: [x], to: "library", at: 9999 }).zones.library.at(-1), x, "an index past the end clamps to the end");
  assert.equal(run(hand, { type: "MOVE_MANY", ids: [x], to: "library", at: -4 }).zones.library[0], x, "a negative index clamps to the top");
});

test("MOVE_MANY ignores unknown and duplicate ids and is a no-op when nothing valid remains", () => {
  const state = fixtureSixtyCardStart();
  const [a] = ids(state, 1);
  const next = run(state, { type: "MOVE_MANY", ids: [a, a, "ghost"], to: "graveyard", at: "bottom" });
  assert.deepEqual(next.zones.graveyard, [a]);
  assert.equal(applyCommand(state, { type: "MOVE_MANY", ids: ["ghost"], to: "hand", at: "top" }), state);
  assert.equal(applyCommand(state, { type: "MOVE_MANY", ids: [], to: "hand", at: "top" }), state);
});

test("moving cards to the battlefield gives each a distinct free position; play tapped and face down are one step", () => {
  const state = fixtureSixtyCardStart();
  const next = run(state, { type: "MOVE_MANY", ids: ids(state, 4), to: "battlefield", at: "bottom", tapped: true, faceDown: true });
  const positions = next.zones.battlefield.map((id) => JSON.stringify(next.cards[id].pos));
  assert.equal(new Set(positions).size, 4, "no two cards land on the same spot");
  for (const id of next.zones.battlefield) {
    assert.equal(next.cards[id].tapped, true);
    assert.equal(next.cards[id].face, "face-down");
  }
});

test("a chosen drop position is kept, rounded and clamped onto the board", () => {
  const state = fixtureSixtyCardStart();
  const [a] = ids(state, 1);
  const next = run(state, { type: "MOVE_MANY", ids: [a], to: "battlefield", at: "bottom", pos: { x: 2, y: -1 } });
  const pos = next.cards[a].pos!;
  assert.ok(pos.x <= 1 && pos.x >= 0 && pos.y === 0);
});

test("DRAW from an empty library never duplicates or crashes; MILL and DRAW keep card count", () => {
  let state = fixtureSixtyCardStart();
  const total = Object.keys(state.cards).length;
  state = run(state, { type: "DRAW", count: 60 });
  assert.equal(applyCommand(state, { type: "DRAW", count: 5 }), state, "empty draw is a no-op with no new event");
  assert.equal(applyCommand(state, { type: "MILL", count: 5 }), state);
  const back = run(state, { type: "MOVE_MANY", ids: state.zones.hand.slice(0, 10), to: "library", at: "top" });
  const milled = run(back, { type: "MILL", count: 4 });
  assert.equal(milled.zones.graveyard.length, 4);
  const all = Object.values(milled.zones).flat();
  assert.equal(all.length, total);
  assert.equal(new Set(all).size, total);
});

test("REORDER_ZONE accepts only an exact rearrangement", () => {
  const state = run(fixtureSixtyCardStart(), { type: "DRAW", count: 4 });
  const hand = state.zones.hand;
  const sorted = [...hand].reverse();
  assert.deepEqual(run(state, { type: "REORDER_ZONE", zone: "hand", order: sorted }).zones.hand, sorted);
  assert.equal(applyCommand(state, { type: "REORDER_ZONE", zone: "hand", order: hand }), state, "same order: no-op");
  assert.equal(applyCommand(state, { type: "REORDER_ZONE", zone: "hand", order: hand.slice(1) }), state, "a missing card is refused");
  assert.equal(applyCommand(state, { type: "REORDER_ZONE", zone: "hand", order: [...hand.slice(1), state.zones.library[0]] }), state, "a foreign card is refused");
  assert.equal(applyCommand(state, { type: "REORDER_ZONE", zone: "hand", order: [hand[0], hand[0], hand[2], hand[3]] }), state, "a duplicate is refused");
  const libBefore = state.zones.library;
  assert.deepEqual(run(state, { type: "REORDER_ZONE", zone: "hand", order: sorted }).zones.library, libBefore, "sorting the hand never changes the library");
});

test("PEEK changes no card state and records a private event that names what was seen", () => {
  const state = fixtureSixtyCardStart();
  const next = run(state, { type: "PEEK", zone: "library", from: "top", count: 3 });
  assert.deepEqual(next.zones, state.zones);
  assert.deepEqual(next.cards, state.cards);
  const event = next.events[0];
  assert.equal(event.private, true);
  assert.deepEqual(event.ids, ids(state, 3));
  const bottom = run(state, { type: "PEEK", zone: "library", from: "bottom", count: 2 });
  assert.deepEqual(bottom.events[0].ids, state.zones.library.slice(-2));
  assert.equal(applyCommand(state, { type: "PEEK", zone: "graveyard", from: "top", count: 3 }), state, "nothing to look at");
});

test("SET_CARD_FLAGS changes only what differs, names only changed cards, and refuses bad values", () => {
  let state = fixtureSixtyCardStart();
  const [a, b] = ids(state, 2);
  state = run(state, { type: "MOVE_MANY", ids: [a, b], to: "battlefield", at: "bottom" });
  state = run(state, { type: "SET_TAPPED", cardId: a, tapped: true });
  const both = run(state, { type: "SET_CARD_FLAGS", ids: [a, b], flags: { tapped: true } });
  assert.deepEqual(both.events.at(-1)?.ids, [b], "a was already tapped, so only b is reported");
  assert.equal(applyCommand(both, { type: "SET_CARD_FLAGS", ids: [a, b], flags: { tapped: true } }), both, "nothing changed: same reference");
  const offset = run(state, { type: "SET_CARD_FLAGS", ids: [a], flags: { ptOffset: { power: 500, toughness: -500 }, commanderTax: -3 } });
  assert.deepEqual(offset.cards[a].ptOffset, { power: 99, toughness: -99 }, "offsets are clamped");
  assert.equal(offset.cards[a].commanderTax, 0);
  const bad = applyCommand(state, { type: "SET_CARD_FLAGS", ids: [a], flags: { rotation: 45 as 0 } });
  assert.equal(bad.cards[a].rotation, 0, "an invalid rotation is ignored");
});

test("counters: named, floored at zero, and a zero count removes the key", () => {
  let state = fixtureSixtyCardStart();
  const [a] = ids(state, 1);
  state = run(state, { type: "ADD_COUNTER", cardId: a, name: "  Shield  ", delta: 2 });
  assert.deepEqual(state.cards[a].counters, { Shield: 2 });
  state = run(state, { type: "ADD_COUNTER", cardId: a, name: "Shield", delta: -10 });
  assert.deepEqual(state.cards[a].counters, {});
  assert.equal(applyCommand(state, { type: "ADD_COUNTER", cardId: a, name: "   ", delta: 1 }), state, "a blank name is refused");
  assert.equal(applyCommand(state, { type: "ADD_COUNTER", cardId: a, name: "x", delta: 0 }), state);
  const capped = run(state, { type: "ADD_COUNTER", cardId: a, name: "x", delta: 10 ** 9 });
  assert.equal(capped.cards[a].counters.x, 9999);
});

test("PROLIFERATE adds one to counter types a card already has and never invents a type", () => {
  let state = fixtureSixtyCardStart();
  const [a, b] = ids(state, 2);
  state = run(state, { type: "MOVE_MANY", ids: [a, b], to: "battlefield", at: "bottom" });
  state = run(state, { type: "ADD_COUNTER", cardId: a, name: "+1/+1", delta: 2 });
  state = run(state, { type: "ADD_COUNTER", cardId: a, name: "loyalty", delta: 3 });
  const next = run(state, { type: "PROLIFERATE", ids: [a, b] });
  assert.deepEqual(next.cards[a].counters, { "+1/+1": 3, loyalty: 4 });
  assert.deepEqual(next.cards[b].counters, {}, "a card with no counters gains none");
  assert.equal(applyCommand(next, { type: "PROLIFERATE", ids: [b] }), next);
});

test("SET_TRACKER takes absolute values, clamps, and accepts only known paths", () => {
  let state = fixtureSixtyCardStart();
  state = run(state, { type: "SET_TRACKER", path: "life", value: 27 });
  assert.equal(state.trackers.life, 27);
  assert.equal(applyCommand(state, { type: "SET_TRACKER", path: "life", value: 27 }), state, "same value: no-op");
  assert.equal(run(state, { type: "SET_TRACKER", path: "poison", value: -4 }), state, "poison floors at 0, which is unchanged");
  assert.equal(run(state, { type: "SET_TRACKER", path: "life", value: 10 ** 12 }).trackers.life, 9999);
  assert.equal(run(state, { type: "SET_TRACKER", path: "life", value: -5 }).trackers.life, -5, "life may go negative");
  state = run(state, { type: "SET_TRACKER", path: "manaPool.G", value: 3 });
  assert.equal(state.trackers.manaPool.G, 3);
  state = run(state, { type: "SET_TRACKER", path: "commanderDamage.Atraxa", value: 9 });
  assert.deepEqual(state.trackers.commanderDamage, { Atraxa: 9 });
  state = run(state, { type: "SET_TRACKER", path: "commanderDamage.Atraxa", value: 0 });
  assert.deepEqual(state.trackers.commanderDamage, {}, "zero removes the entry");
  for (const path of ["nope", "manaPool.X", "commanderDamage.", "__proto__", "turn"]) {
    assert.equal(applyCommand(state, { type: "SET_TRACKER", path, value: 5 }), state, path);
  }
  assert.equal(applyCommand(state, { type: "SET_TRACKER", path: "life", value: Number.NaN }), state);
});

test("SET_LAYOUT is one step for many cards, clamps positions, and takes cards out of groups", () => {
  let state = fixtureSixtyCardStart();
  const [a, b, c] = ids(state, 3);
  state = run(state, { type: "MOVE_MANY", ids: [a, b, c], to: "battlefield", at: "bottom" });
  state = run(state, { type: "SET_GROUP", ids: [a, b], groupId: "g", group: { label: "Pair", anchor: { x: 0.2, y: 0.2 } } });
  const before = state.events.length;
  const next = run(state, { type: "SET_LAYOUT", placements: [{ id: a, x: 0.5, y: 0.5 }, { id: c, x: 9, y: 9 }, { id: "ghost", x: 0, y: 0 }] });
  assert.equal(next.events.length, before + 1);
  assert.equal(next.cards[a].groupId, null);
  assert.deepEqual(next.cards[a].pos, { x: 0.5, y: 0.5 });
  assert.ok(next.cards[c].pos!.x <= 1 && next.cards[c].pos!.y <= 1);
  assert.equal(next.cards[b].groupId, "g");
  assert.equal(applyCommand(next, { type: "SET_LAYOUT", placements: [{ id: a, x: 0.5, y: 0.5 }] }), next, "an identical placement is a no-op");
  const order = [c, b, a];
  assert.deepEqual(run(next, { type: "SET_LAYOUT", placements: [], order }).zones.battlefield, order, "order changes the stacking");
  assert.equal(applyCommand(next, { type: "SET_LAYOUT", placements: [], order: [a] }), next, "a partial order is refused");
});

test("SET_GROUP creates, updates, moves and dissolves a group; empty groups vanish", () => {
  let state = fixtureSixtyCardStart();
  const [a, b] = ids(state, 2);
  state = run(state, { type: "MOVE_MANY", ids: [a, b], to: "battlefield", at: "bottom" });
  state = run(state, { type: "SET_GROUP", ids: [a, b], groupId: "g1", group: { label: "Elves", arrangement: "column", anchor: { x: 0.3, y: 0.3 } } });
  assert.deepEqual(state.groups.g1, { label: "Elves", arrangement: "column", anchor: { x: 0.3, y: 0.3 } });
  assert.equal(state.cards[a].pos, null);
  state = run(state, { type: "SET_GROUP", ids: [], groupId: "g1", group: { anchor: { x: 0.6, y: 0.1 }, arrangement: "stack" } });
  assert.deepEqual(state.groups.g1.anchor, { x: 0.6, y: 0.1 });
  assert.equal(state.groups.g1.arrangement, "stack");
  assert.equal(applyCommand(state, { type: "SET_GROUP", ids: [a], groupId: "bad id!", group: {} }), state, "an unsafe group id is refused");
  const ungrouped = run(state, { type: "SET_GROUP", ids: [a, b], groupId: null });
  assert.deepEqual(ungrouped.groups, {}, "an emptied group is dropped");
  assert.notEqual(ungrouped.cards[a].pos, null, "an ungrouped card keeps where it was on the table");
  const moved = run(state, { type: "MOVE_MANY", ids: [a, b], to: "hand", at: "bottom" });
  assert.deepEqual(moved.groups, {}, "leaving the battlefield empties and drops the group");
});

test("CREATE_EXTRA makes tokens, extras and real copies with their own ids; refuses collisions", () => {
  let state = fixtureSixtyCardStart();
  const [a] = ids(state, 1);
  state = run(state, { type: "MOVE_MANY", ids: [a], to: "battlefield", at: "bottom" });
  const spec = { name: "Treasure", power: null, toughness: null, imageSmall: "https://cards.scryfall.io/s.jpg", imageNormal: "http://insecure/n.jpg" };
  state = run(state, { type: "CREATE_EXTRA", ids: ["t1", "t2", a], spec, kind: "token", zone: "battlefield" });
  assert.equal(state.cards.t1.kind, "token");
  assert.equal(state.cards.t1.imageNormal, null, "a non-https image URL is dropped");
  assert.equal(state.cards[a].kind, "deck-card", "an existing id is never overwritten");
  state = run(state, { type: "CREATE_EXTRA", ids: ["c1"], spec: { ...spec, name: "Copy of X" }, kind: "copy", copiedFromId: a, zone: "battlefield" });
  assert.equal(state.cards.c1.kind, "copy");
  assert.equal(state.cards.c1.copiedFromId, a);
  assert.equal(applyCommand(state, { type: "CREATE_EXTRA", ids: ["c2"], spec, kind: "copy", zone: "hand" }), state, "a copy must say what it copies");
  const deckCards = Object.values(state.cards).filter((c) => c.kind === "deck-card").length;
  assert.equal(deckCards, 60);
  assert.equal(state.zones.library.length, 59, "the library is untouched by token creation");
});

test("DELETE_OBJECT is undoable through history and clears commander bookkeeping", () => {
  let state = fixtureSixtyCardStart();
  state = run(state, { type: "CREATE_EXTRA", ids: ["t1"], spec: { name: "Spirit", power: "1", toughness: "1", imageSmall: null, imageNormal: null }, kind: "token", zone: "battlefield" });
  const history = record(emptyHistory(), state);
  const deleted = run(state, { type: "DELETE_OBJECT", cardId: "t1" });
  assert.ok(!("t1" in deleted.cards));
  const step = undo(history, deleted);
  assert.deepEqual(step?.state, state);
});

test("ROLL records a valid result and refuses an impossible one", () => {
  const state = fixtureSixtyCardStart();
  const rolled = run(state, { type: "ROLL", kind: "d20", result: 17 });
  assert.equal(rolled.events[0].data.result, 17);
  assert.equal(applyCommand(state, { type: "ROLL", kind: "d6", result: 7 }), state);
  assert.equal(applyCommand(state, { type: "ROLL", kind: "d6", result: 0 }), state);
  assert.equal(applyCommand(state, { type: "ROLL", kind: "coin", result: 2 }), state);
  assert.equal(run(state, { type: "ROLL", kind: "coin", result: 0 }).events[0].data.result, 0);
});

test("RANDOM_DISCARD moves the carried card from hand to graveyard and refuses a card not in hand", () => {
  const state = run(fixtureSixtyCardStart(), { type: "DRAW", count: 3 });
  const victim = state.zones.hand[1];
  const next = run(state, { type: "RANDOM_DISCARD", cardId: victim });
  assert.deepEqual(next.zones.graveyard, [victim]);
  assert.equal(applyCommand(state, { type: "RANDOM_DISCARD", cardId: state.zones.library[0] }), state);
});

test("SHUFFLE is deterministic for a seed and preserves membership", () => {
  const state = fixtureSixtyCardStart();
  const a = run(state, { type: "SHUFFLE", zone: "library", seed: 99 });
  const b = run(state, { type: "SHUFFLE", zone: "library", seed: 99 });
  assert.deepEqual(a.zones.library, b.zones.library);
  assert.deepEqual([...a.zones.library].sort(), [...state.zones.library].sort());
});

test("NEXT_TURN is one command: untap, draw (unless on the play), empty the mana pool, one event", () => {
  const cards = [makeGameCard("l1", "Forest", { typeLine: "Basic Land", producesMana: true }), makeGameCard("l2", "Forest", { typeLine: "Basic Land", producesMana: true }), makeGameCard("c1", "Bear", { typeLine: "Creature", power: "2", toughness: "2" }), makeGameCard("d1", "Draw Me"), makeGameCard("d2", "Draw Me Too")];
  let state = makeState(cards, { battlefield: ["l1", "l2", "c1"], library: ["d1", "d2"] });
  state = { ...state, cards: { ...state.cards, l1: { ...state.cards.l1, tapped: true, pos: { x: 0, y: 0 } }, l2: { ...state.cards.l2, tapped: true, pos: { x: 0.1, y: 0 } }, c1: { ...state.cards.c1, tapped: true, pos: { x: 0.2, y: 0 } } } };
  state = run(state, { type: "SET_TRACKER", path: "manaPool.R", value: 4 });

  const t1 = run(state, { type: "NEXT_TURN" });
  assert.equal(t1.turn, 1);
  assert.equal(t1.zones.hand.length, 0, "on the play: no draw on turn one");
  assert.ok(["l1", "l2", "c1"].every((id) => !t1.cards[id].tapped));
  assert.equal(t1.trackers.manaPool.R, 0);

  const t2 = run(t1, { type: "NEXT_TURN" });
  assert.deepEqual(t2.zones.hand, ["d1"], "one draw from the top");
  const last = t2.events.at(-1)!;
  assert.equal(last.kind, "turn");
  assert.equal(last.data.power, 2);
  assert.equal(last.data.producers, 2);
  assert.equal(new Set(t2.events.slice(-2).map((e) => e.gestureId)).size, 2, "each command is its own gesture");

  const onDraw = run({ ...state, config: { ...state.config, firstTurnDraws: true } }, { type: "NEXT_TURN" });
  assert.deepEqual(onDraw.zones.hand, ["d1"], "on the draw: turn one draws");
});

test("NEXT_TURN does nothing while the opening hand is still being decided", () => {
  const state = { ...fixtureSixtyCardStart(), opening: { status: "deciding" as const, mulligans: 0 } };
  assert.equal(applyCommand(state, { type: "NEXT_TURN" }), state);
});

test("BATCH applies every command under ONE gesture id", () => {
  const state = fixtureSixtyCardStart();
  const [a, b] = ids(state, 2);
  const next = run(state, {
    type: "BATCH",
    commands: [
      { type: "MOVE_MANY", ids: [a, b], to: "battlefield", at: "bottom" },
      { type: "SET_CARD_FLAGS", ids: [a, b], flags: { tapped: true } },
      { type: "SET_TRACKER", path: "life", value: 10 },
    ],
  });
  assert.equal(next.events.length, 3);
  assert.equal(new Set(next.events.map((e) => e.gestureId)).size, 1);
});

test("multi-card commands undo atomically: one history entry restores every card", () => {
  const start = fixtureSixtyCardStart();
  const some = ids(start, 8);
  let history = emptyHistory();
  let state = start;
  const commands: GameCommand[] = [
    { type: "MOVE_MANY", ids: some, to: "battlefield", at: "bottom" },
    { type: "SET_CARD_FLAGS", ids: some, flags: { tapped: true, dimmed: true } },
    { type: "PROLIFERATE", ids: some },
  ];
  for (const command of commands) {
    history = record(history, state);
    state = applyCommand(state, command);
  }
  for (let i = commands.length - 1; i >= 0; i--) {
    const step = undo(history, state)!;
    history = step.history;
    state = step.state;
  }
  assert.deepEqual(state, start, "three gestures, three undos, back to the start with nothing half-applied");
});

test("VOID_EVENT hides an entry without touching the board", () => {
  const state = run(fixtureSixtyCardStart(), { type: "SET_TRACKER", path: "life", value: 5 });
  const voided = run(state, { type: "VOID_EVENT", seq: state.events[0].seq, voided: true });
  assert.equal(voided.events[0].voided, true);
  assert.deepEqual(voided.trackers, state.trackers);
  assert.equal(applyCommand(state, { type: "VOID_EVENT", seq: 999, voided: true }), state);
});

test("reveal flags a card and never changes its zone", () => {
  const state = run(fixtureSixtyCardStart(), { type: "DRAW", count: 2 });
  const [a] = state.zones.hand;
  const next = run(state, { type: "REVEAL", ids: [a], revealed: true });
  assert.equal(next.cards[a].revealed, true);
  assert.deepEqual(next.zones, state.zones);
  assert.equal(applyCommand(next, { type: "REVEAL", ids: [a], revealed: true }), next);
});

test("the event log is capped at 1,000 and records where it was cut", () => {
  let state = fixtureSixtyCardStart();
  for (let i = 0; i < 1100; i++) state = applyCommand(state, { type: "SET_TRACKER", path: "life", value: i % 2 === 0 ? 5 : 6 });
  assert.equal(state.events.length, 1000);
  assert.equal(state.eventsTruncatedBefore, state.events[0].seq);
  assert.ok(state.nextEventSeq > 1000, "seq numbers keep counting past the cap");
  assert.deepEqual(checkInvariants(state), []);
});
