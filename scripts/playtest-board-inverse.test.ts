/**
 * invertCommand: applying a command's inverse to the post-command state
 * reproduces the pre-command state, ignoring the event log (which grows with
 * every applied command). Narrow field setters have an exact small inverse;
 * everything else falls back to RESTORE_SNAPSHOT of the prior state, and this
 * test pins that EVERY command in the union is covered by one or the other.
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

function withoutEvents(state: GameState): Omit<GameState, "events" | "nextEventSeq"> {
  const clone: Partial<GameState> = { ...state };
  delete clone.events;
  delete clone.nextEventSeq;
  return clone as Omit<GameState, "events" | "nextEventSeq">;
}

function assertUndoRestores(before: GameState, command: GameCommand) {
  const after = applyCommand(before, command);
  let restored = after;
  for (const inverse of invertCommand(command, before)) restored = applyCommand(restored, inverse);
  assert.deepEqual(withoutEvents(restored), withoutEvents(before), `undo of ${command.type} did not restore prior state`);
}

test("undo restores the previous state for every command in the union", () => {
  const start = fixtureSixtyCardStart();
  const [a, b, c] = start.zones.library;
  const onTable = applyCommand(start, { type: "MOVE_MANY", ids: [a, b, c], to: "battlefield", at: "bottom" });

  const commands: GameCommand[] = [
    { type: "DRAW", count: 3 },
    { type: "MILL", count: 2 },
    { type: "MOVE_CARD", cardId: a, to: "hand", index: null },
    { type: "MOVE_MANY", ids: [a, b], to: "graveyard", at: "top" },
    { type: "REORDER_ZONE", zone: "library", order: [...start.zones.library].reverse() },
    { type: "PEEK", zone: "library", from: "top", count: 3 },
    { type: "REVEAL", ids: [a], revealed: true },
    { type: "SET_TAPPED", cardId: a, tapped: true },
    { type: "SET_FACE", cardId: a, face: "face-down" },
    { type: "SET_NOTE", cardId: a, note: "Combo piece" },
    { type: "SET_ROTATION", cardId: a, rotation: 90 },
    { type: "SET_CARD_FLAGS", ids: [a, b], flags: { tapped: true, dimmed: true, ptOffset: { power: 1, toughness: 1 }, commanderTax: 2 } },
    { type: "ADD_COUNTER", cardId: a, name: "+1/+1", delta: 3 },
    { type: "PROLIFERATE", ids: [a] },
    { type: "CREATE_EXTRA", ids: ["t1", "t2"], spec: { name: "Soldier", power: "1", toughness: "1", imageSmall: null, imageNormal: null }, kind: "token", zone: "battlefield" },
    { type: "SHUFFLE", zone: "library", seed: 7 },
    { type: "SET_LIFE", delta: -5 },
    { type: "SET_TRACKER", path: "poison", value: 4 },
    { type: "SET_LAYOUT", placements: [{ id: a, x: 0.5, y: 0.5 }] },
    { type: "SET_GROUP", ids: [a, b], groupId: "g", group: { label: "Pair" } },
    { type: "NEXT_TURN" },
    { type: "SET_TURN", turn: 5 },
    { type: "ROLL", kind: "d6", result: 4 },
    { type: "RANDOM_DISCARD", cardId: a },
    { type: "BATCH", commands: [{ type: "SET_TAPPED", cardId: a, tapped: true }, { type: "SET_LIFE", delta: -1 }] },
    { type: "RESTORE_SNAPSHOT", snapshot: fixtureCommanderStart() },
  ];
  for (const command of commands) assertUndoRestores(onTable, command);

  // Commands that need a specific prior state.
  const withToken = applyCommand(start, { type: "CREATE_EXTRA", ids: ["token-3"], spec: { name: "Spirit", power: "1", toughness: "1", imageSmall: null, imageNormal: null }, kind: "token", zone: "battlefield" });
  assertUndoRestores(withToken, { type: "DELETE_OBJECT", cardId: "token-3" });
  const dealt = applyCommand({ ...start, opening: { status: "deciding", mulligans: 0 } }, { type: "MULLIGAN", seed: 9 });
  assertUndoRestores({ ...start, opening: { status: "deciding", mulligans: 0 } }, { type: "MULLIGAN", seed: 9 });
  assert.equal(dealt.opening.mulligans, 1);
  const withEvent = applyCommand(start, { type: "SET_LIFE", delta: -1 });
  assertUndoRestores(withEvent, { type: "VOID_EVENT", seq: withEvent.events[0].seq, voided: true });
  assertUndoRestores(start, {
    type: "RECORD_INTERACTION",
    turn: 3,
    rerollIndex: 0,
    prompts: ["attack"],
    resolution: "pending",
  });
  assertUndoRestores(start, { type: "SET_SIMULATOR", settings: { ...start.simulator.settings, enabled: true } });

  // Counters floor at zero, so the inverse restores the exact prior count.
  const bumped = applyCommand(start, { type: "ADD_COUNTER", cardId: b, name: "loyalty", delta: 4 });
  assertUndoRestores(bumped, { type: "ADD_COUNTER", cardId: b, name: "loyalty", delta: -9 });
});

test("undo/redo round trips through a varied command sequence", () => {
  const start = fixtureSixtyCardStart();
  const commands: GameCommand[] = [
    { type: "DRAW", count: 7 },
    { type: "MOVE_CARD", cardId: start.zones.library[7], to: "battlefield", index: null },
    { type: "SET_TAPPED", cardId: start.zones.library[7], tapped: true },
    { type: "ADD_COUNTER", cardId: start.zones.library[7], name: "+1/+1", delta: 1 },
    { type: "SET_LIFE", delta: -2 },
    { type: "NEXT_TURN" },
  ];

  const trail: Array<{ before: GameState; command: GameCommand }> = [];
  let state = start;
  for (const command of commands) {
    trail.push({ before: state, command });
    state = applyCommand(state, command);
  }
  const finalState = state;

  let undone = finalState;
  for (let i = trail.length - 1; i >= 0; i--) {
    const { before, command } = trail[i];
    for (const inverse of invertCommand(command, before)) undone = applyCommand(undone, inverse);
  }
  assert.deepEqual(withoutEvents(undone), withoutEvents(start));

  let redone = undone;
  for (const { command } of trail) redone = applyCommand(redone, command);
  assert.deepEqual(withoutEvents(redone), withoutEvents(finalState));
});
