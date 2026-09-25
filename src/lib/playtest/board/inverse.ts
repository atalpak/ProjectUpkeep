/**
 * Per-command undo, as commands. The real undo button does NOT use this: it
 * swaps whole states through `history.ts`, which is exact for every command
 * and cannot drift. This module exists for the callers that want a semantic
 * inverse (and for the tests that pin what "the inverse of X" means), and it
 * is deliberately small.
 *
 * Only the commands whose effect is one narrow field have an exact small
 * inverse. Moves no longer do: leaving the battlefield wipes tapped state,
 * counters and position (see reducers/zones.ts), so "move it back" cannot
 * restore what the move discarded. Everything that cannot be inverted exactly
 * falls back to `RESTORE_SNAPSHOT` of the state before it, the same
 * simplest-correct choice the plan recommends. Adding a command therefore
 * costs nothing here: it gets the fallback until someone proves it needs more.
 *
 * "Restores the previous state" is checked ignoring the event log, which is
 * expected to grow with every applied command.
 */

import type { GameCommand } from "./commands";
import type { GameState } from "./types";

export function invertCommand(command: GameCommand, before: GameState): GameCommand[] {
  switch (command.type) {
    case "SET_TAPPED": {
      const card = before.cards[command.cardId];
      if (!card) return [];
      return [{ type: "SET_TAPPED", cardId: command.cardId, tapped: card.tapped }];
    }
    case "SET_FACE": {
      const card = before.cards[command.cardId];
      if (!card) return [];
      return [{ type: "SET_FACE", cardId: command.cardId, face: card.face }];
    }
    case "SET_NOTE": {
      const card = before.cards[command.cardId];
      if (!card) return [];
      return [{ type: "SET_NOTE", cardId: command.cardId, note: card.note }];
    }
    case "SET_ROTATION": {
      const card = before.cards[command.cardId];
      if (!card) return [];
      return [{ type: "SET_ROTATION", cardId: command.cardId, rotation: card.rotation }];
    }
    case "ADD_COUNTER": {
      const card = before.cards[command.cardId];
      if (!card) return [];
      // Restore the exact prior count rather than negating the delta, which
      // is wrong once the count has been floored at zero.
      const previous = card.counters[command.name.trim()] ?? 0;
      const now = Math.max(0, previous + command.delta);
      return [{ type: "ADD_COUNTER", cardId: command.cardId, name: command.name, delta: previous - now }];
    }
    default:
      return [{ type: "RESTORE_SNAPSHOT", snapshot: before }];
  }
}
