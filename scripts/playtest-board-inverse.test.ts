/**
 * invertCommand: for every supported command, applying its inverse to the
 * post-command state reproduces the pre-command state exactly (ignoring the
 * log, which is expected to grow with each apply — see the header on
 * inverse.ts for which commands invert exactly vs. via a full restore).
 *
 * Run with: npx tsx --test scripts/playtest-board-inverse.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { invertCommand } from "../src/lib/playtest/board/inverse";
import { fixtureCommanderStart, fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import type { GameCommand } from "../src/lib/playtest/board/commands";
import type { GameState } from "../src/lib/playtest/board/types";

function withoutLog(state: GameState): Omit<GameState, "log"> {
  const clone: Partial<GameState> = { ...state };
  delete clone.log;
  return clone as Omit<GameState, "log">;
}

function assertUndoRestores(before: GameState, command: GameCommand) {
  const after = applyCommand(before, command);
  const inverses = invertCommand(command, before);
  let restored = after;
  for (const inverse of inverses) restored = applyCommand(restored, inverse);
  assert.deepEqual(withoutLog(restored), withoutLog(before), `undo of ${command.type} did not restore prior state`);
}

test("undo restores the previous state for every supported command", () => {
  const start = fixtureSixtyCardStart();
  const cardId = start.zones.library[0];
  const secondCardId = start.zones.library[1];

  assertUndoRestores(start, { type: "DRAW", count: 3 });
  assertUndoRestores(start, { type: "MOVE_CARD", cardId, to: "hand", index: null });
  assertUndoRestores(start, {
    type: "MOVE_CARD",
    cardId,
    to: "battlefield",
    index: null,
    groupId: "group-a",
  });
  assertUndoRestores(start, { type: "SET_TAPPED", cardId, tapped: true });
  assertUndoRestores(start, { type: "SET_FACE", cardId, face: "face-down" });
  assertUndoRestores(start, { type: "ADD_COUNTER", cardId, name: "+1/+1", delta: 3 });
  assertUndoRestores(start, {
    type: "CREATE_TOKEN",
    ids: ["token-1", "token-2"],
    token: { name: "Soldier", power: "1", toughness: "1", imageUri: null },
    zone: "battlefield",
  });
  assertUndoRestores(start, { type: "SHUFFLE", zone: "library", seed: 7 });
  assertUndoRestores(start, { type: "SET_LIFE", delta: -5 });
  assertUndoRestores(start, { type: "NEXT_TURN" });
  assertUndoRestores(start, { type: "RESTORE_SNAPSHOT", snapshot: fixtureCommanderStart() });

  // DELETE_OBJECT needs an object that actually exists to delete.
  const withToken = applyCommand(start, {
    type: "CREATE_TOKEN",
    ids: ["token-3"],
    token: { name: "Spirit", power: "1", toughness: "1", imageUri: null },
    zone: "battlefield",
  });
  assertUndoRestores(withToken, { type: "DELETE_OBJECT", cardId: "token-3" });

  // Chained ADD_COUNTER twice, undoing the second, on the same card.
  const bumped = applyCommand(start, { type: "ADD_COUNTER", cardId: secondCardId, name: "loyalty", delta: 4 });
  assertUndoRestores(bumped, { type: "ADD_COUNTER", cardId: secondCardId, name: "loyalty", delta: -1 });
});

test("undo/redo round trips through a varied command sequence", () => {
  const start = fixtureSixtyCardStart();
  const commands: GameCommand[] = [
    { type: "DRAW", count: 7 },
    { type: "MOVE_CARD", cardId: start.zones.library[7], to: "battlefield", index: null, groupId: "a" },
    { type: "SET_TAPPED", cardId: start.zones.library[7], tapped: true },
    { type: "ADD_COUNTER", cardId: start.zones.library[7], name: "+1/+1", delta: 1 },
    { type: "SET_LIFE", delta: -2 },
    { type: "NEXT_TURN" },
  ];

  // Apply the whole sequence forward, recording (state-before, command) pairs.
  const trail: Array<{ before: GameState; command: GameCommand }> = [];
  let state = start;
  for (const command of commands) {
    trail.push({ before: state, command });
    state = applyCommand(state, command);
  }
  const finalState = state;

  // Undo everything, one command at a time, in reverse order.
  let undone = finalState;
  for (let i = trail.length - 1; i >= 0; i--) {
    const { before, command } = trail[i];
    for (const inverse of invertCommand(command, before)) undone = applyCommand(undone, inverse);
  }
  assert.deepEqual(withoutLog(undone), withoutLog(start));

  // Redo everything by reapplying the original commands in order.
  let redone = undone;
  for (const { command } of trail) redone = applyCommand(redone, command);
  assert.deepEqual(withoutLog(redone), withoutLog(finalState));
});
