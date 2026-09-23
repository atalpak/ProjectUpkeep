/**
 * Bounded undo/redo (board/history.ts): the "store the previous state" stack
 * used by a future UI's undo/redo buttons, independent of per-command
 * inversion (covered separately in playtest-board-inverse.test.ts).
 *
 * Run with: npx tsx --test scripts/playtest-board-history.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { canRedo, canUndo, emptyHistory, record, redo, undo } from "../src/lib/playtest/board/history";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import type { GameCommand } from "../src/lib/playtest/board/commands";

test("undo/redo round trips a varied command sequence via stored states", () => {
  const start = fixtureSixtyCardStart();
  const commands: GameCommand[] = [
    { type: "DRAW", count: 5 },
    { type: "SET_LIFE", delta: -3 },
    { type: "MOVE_CARD", cardId: start.zones.library[0], to: "battlefield", index: null, groupId: null },
    { type: "NEXT_TURN" },
  ];

  let state = start;
  let history = emptyHistory();
  const snapshots = [state];
  for (const command of commands) {
    history = record(history, state);
    state = applyCommand(state, command);
    snapshots.push(state);
  }
  const finalState = state;

  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), false);

  // Undo all the way back to the start.
  let current = state;
  for (let i = commands.length; i >= 1; i--) {
    const step = undo(history, current);
    assert.ok(step, `expected an undo step at index ${i}`);
    history = step!.history;
    current = step!.state;
    assert.deepEqual(current, snapshots[i - 1]);
  }
  assert.equal(canUndo(history), false);
  assert.equal(undo(history, current), null);

  // Redo all the way forward again.
  for (let i = 1; i <= commands.length; i++) {
    const step = redo(history, current);
    assert.ok(step, `expected a redo step at index ${i}`);
    history = step!.history;
    current = step!.state;
    assert.deepEqual(current, snapshots[i]);
  }
  assert.equal(canRedo(history), false);
  assert.deepEqual(current, finalState);
});

test("recording a new action after an undo discards the redo branch", () => {
  const start = fixtureSixtyCardStart();
  let history = record(emptyHistory(), start);
  let state = applyCommand(start, { type: "NEXT_TURN" });

  const step = undo(history, state);
  assert.ok(step);
  history = step!.history;
  state = step!.state;
  assert.equal(canRedo(history), true);

  history = record(history, state);
  state = applyCommand(state, { type: "SET_LIFE", delta: 1 });

  assert.equal(canRedo(history), false);
});

test("history is capped at 200 entries on the past stack", () => {
  let history = emptyHistory();
  const start = fixtureSixtyCardStart();
  for (let i = 0; i < 250; i++) {
    history = record(history, { ...start, turn: i });
  }
  assert.equal(history.past.length, 200);
  // The oldest 50 entries were dropped; the stack keeps the most recent 200.
  assert.equal(history.past[0].turn, 50);
  assert.equal(history.past[199].turn, 249);
});
