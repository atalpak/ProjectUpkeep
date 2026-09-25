/**
 * The one place `GameState` changes. `applyCommand` never mutates its input:
 * every command returns a fresh state, or the SAME reference when it changed
 * nothing, which is what lets the store skip an empty undo step and lets the
 * bounded undo history (`history.ts`) swap whole states safely.
 *
 * This file is only the dispatcher. The work lives in `reducers/`, one file
 * per concern (zones, cards, extras, trackers, layout, simulator, log), so a
 * change to how counters work does not sit in the same file as the mulligan.
 *
 * A command that targets an object that no longer exists (a stale undo replay
 * after a delete, a UI race) is a no-op rather than a thrown error: the board
 * must not crash mid-game, and there is nothing useful to invert either.
 */

import type { GameCommand } from "./commands";
import { addCounter, proliferate, reveal, setCardFlags, setNote, setRotation, setTapped } from "./reducers/cards";
import { createExtra, deleteObject } from "./reducers/extras";
import { setGroup, setLayout } from "./reducers/layout";
import { voidEvent, type Ctx } from "./reducers/log";
import { recordInteraction, setSimulator } from "./reducers/simulator";
import { nextTurn, roll, setLife, setTracker, setTurn } from "./reducers/trackers";
import { draw, keep, mill, moveMany, mulligan, peek, randomDiscard, reorderZone, shuffle } from "./reducers/zones";
import type { GameState } from "./types";

/** Only what a pure reducer cannot know: the wall-clock time the browser
 *  store stamps on the events. Omitted (0) in tests and in replays. */
export type ApplyOptions = { ts?: number };

function apply(state: GameState, command: GameCommand, ctx: Ctx): GameState {
  switch (command.type) {
    case "DRAW":
      return draw(state, ctx, command.count);
    case "MILL":
      return mill(state, ctx, command.count);
    case "MOVE_CARD":
      return moveMany(state, ctx, [command.cardId], command.to, {
        at: command.index === null ? "bottom" : command.index,
        groupId: command.groupId,
        pos: command.pos,
      });
    case "MOVE_MANY":
      return moveMany(state, ctx, command.ids, command.to, {
        at: command.at,
        groupId: command.groupId,
        pos: command.pos,
        faceDown: command.faceDown,
        tapped: command.tapped,
      });
    case "REORDER_ZONE":
      return reorderZone(state, ctx, command.zone, command.order);
    case "PEEK":
      return peek(state, ctx, command.zone, command.from, command.count);
    case "REVEAL":
      return reveal(state, ctx, command.ids, command.revealed);
    case "SET_TAPPED":
      return setTapped(state, ctx, command.cardId, command.tapped);
    case "SET_FACE":
      return setCardFlags(state, ctx, [command.cardId], { face: command.face });
    case "SET_NOTE":
      return setNote(state, ctx, command.cardId, command.note);
    case "SET_ROTATION":
      return setRotation(state, ctx, command.cardId, command.rotation);
    case "SET_CARD_FLAGS":
      return setCardFlags(state, ctx, command.ids, command.flags);
    case "ADD_COUNTER":
      return addCounter(state, ctx, command.cardId, command.name, command.delta);
    case "PROLIFERATE":
      return proliferate(state, ctx, command.ids);
    case "CREATE_EXTRA":
      return createExtra(state, ctx, command);
    case "DELETE_OBJECT":
      return deleteObject(state, ctx, command.cardId);
    case "SHUFFLE":
      return shuffle(state, ctx, command.zone, command.seed);
    case "SET_LIFE":
      return setLife(state, ctx, command.delta);
    case "SET_TRACKER":
      return setTracker(state, ctx, command.path, command.value);
    case "SET_LAYOUT":
      return setLayout(state, ctx, command.placements, command.order);
    case "SET_GROUP":
      return setGroup(state, ctx, command.ids, command.groupId, command.group);
    case "NEXT_TURN":
      return nextTurn(state, ctx);
    case "SET_TURN":
      return setTurn(state, ctx, command.turn);
    case "ROLL":
      return roll(state, ctx, command.kind, command.result);
    case "MULLIGAN":
      return mulligan(state, ctx, command.seed, command.free === true);
    case "KEEP":
      return keep(state, ctx, command.bottomIds);
    case "RANDOM_DISCARD":
      return randomDiscard(state, ctx, command.cardId);
    case "RECORD_INTERACTION":
      return recordInteraction(state, ctx, command);
    case "SET_SIMULATOR":
      return setSimulator(state, ctx, command.settings);
    case "VOID_EVENT":
      return voidEvent(state, command.seq, command.voided);
    case "BATCH": {
      // Every command in the batch shares one gesture id and timestamp: one
      // batch is one user gesture, one undo step, one group in the log.
      let next = state;
      for (const inner of command.commands) next = apply(next, inner, ctx);
      return next;
    }
    case "RESTORE_SNAPSHOT":
      return command.snapshot;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function applyCommand(state: GameState, command: GameCommand, options: ApplyOptions = {}): GameState {
  return apply(state, command, { ts: options.ts ?? 0, gesture: state.nextEventSeq });
}
