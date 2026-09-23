/**
 * Per-command undo. Most commands have a small, exact inverse computed from
 * the state immediately before they ran (`before`) — that is what lets the
 * action log read like "Moved X to hand" / undo "Moved X back to library"
 * rather than a generic "state restored".
 *
 * Two commands don't have a cheap exact inverse in this command set and fall
 * back to restoring `before` wholesale — simplest-correct, per the plan's own
 * recommendation for undo (section 4.3): `DELETE_OBJECT` would otherwise need
 * a command that can carry an arbitrary reconstructed `GameCard`, and
 * `SHUFFLE`'s true inverse is "the exact prior order", which only a full
 * restore expresses without inventing a twelfth command type. `NEXT_TURN` and
 * `RESTORE_SNAPSHOT` itself get the same treatment for the same reason (no
 * `SET_TURN` command exists, and undoing a restore is definitionally
 * restoring what came before it).
 */

import type { GameCommand } from "./commands";
import { ZONE_IDS, type GameState, type ZoneId } from "./types";

function locate(state: GameState, cardId: string): { zone: ZoneId; index: number } | null {
  for (const zone of ZONE_IDS) {
    const index = state.zones[zone].indexOf(cardId);
    if (index !== -1) return { zone, index };
  }
  return null;
}

/**
 * Returns the command(s) that, applied in order to the state *after*
 * `command` ran, restore `before` exactly. An empty array means there is
 * nothing to undo (the original command was itself a no-op, e.g. it targeted
 * a card id that no longer existed).
 */
export function invertCommand(command: GameCommand, before: GameState): GameCommand[] {
  switch (command.type) {
    case "DRAW": {
      const count = Math.max(0, Math.min(command.count, before.zones.library.length));
      const drawn = before.zones.library.slice(0, count);
      // Reinsert last-drawn first, each at index 0, to reconstruct the
      // original order: after all reinsertions, the first-drawn card ends up
      // back on top.
      return drawn
        .slice()
        .reverse()
        .map((cardId): GameCommand => ({ type: "MOVE_CARD", cardId, to: "library", index: 0 }));
    }

    case "MOVE_CARD": {
      const at = locate(before, command.cardId);
      if (!at) return [];
      const groupId = before.cards[command.cardId]?.groupId ?? null;
      return [{ type: "MOVE_CARD", cardId: command.cardId, to: at.zone, index: at.index, groupId }];
    }

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

    case "ADD_COUNTER":
      return [{ type: "ADD_COUNTER", cardId: command.cardId, name: command.name, delta: -command.delta }];

    case "CREATE_TOKEN":
      return command.ids.map((cardId): GameCommand => ({ type: "DELETE_OBJECT", cardId }));

    case "SET_LIFE":
      return [{ type: "SET_LIFE", delta: -command.delta }];

    case "DELETE_OBJECT":
    case "SHUFFLE":
    case "NEXT_TURN":
    case "RESTORE_SNAPSHOT":
      return [{ type: "RESTORE_SNAPSHOT", snapshot: before }];

    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
