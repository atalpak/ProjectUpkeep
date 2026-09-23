/**
 * The one place `GameState` changes. `applyCommand` never mutates its input —
 * every command returns a fresh state, which is what makes both the bounded
 * undo history (`history.ts`) and per-command inversion (`inverse.ts`) safe
 * to build on top of it.
 *
 * A command targeting a card id that no longer exists (e.g. a stale undo
 * replay after the object was deleted) is a no-op rather than a thrown error
 * — the board should not crash mid-game over a UI race, and there is nothing
 * useful to invert in that case either.
 */

import type { GameCommand } from "./commands";
import { shuffleZone } from "./shuffle";
import { ZONE_IDS, type GameCard, type GameState, type ZoneId } from "./types";

function withoutCard(zones: Record<ZoneId, string[]>, cardId: string): Record<ZoneId, string[]> {
  const next = { ...zones };
  for (const zone of ZONE_IDS) {
    if (next[zone].includes(cardId)) next[zone] = next[zone].filter((id) => id !== cardId);
  }
  return next;
}

function insertAt(list: string[], cardId: string, index: number | null): string[] {
  const copy = [...list];
  if (index === null || index >= copy.length) copy.push(cardId);
  else copy.splice(Math.max(0, index), 0, cardId);
  return copy;
}

function appendLog(state: GameState, text: string): GameState["log"] {
  // Capped generously — this is a readable recent-action log, not the undo
  // mechanism (that's history.ts's bounded past/future stacks). The id is a
  // sequence number derived from the log's own length, not crypto.randomUUID
  // — the same seed plus the same command sequence must produce byte-identical
  // states (Phase 1's determinism guarantee, and later Phase 3's replay/resume
  // story depends on it), and a random id would break that on every command.
  // A sequence number can repeat once the log is capped at 500 entries, but
  // never while both entries are still present: the older one is exactly what
  // slice(-500) just dropped.
  return [...state.log, { id: String(state.log.length), turn: state.turn, text }].slice(-500);
}

export function applyCommand(state: GameState, command: GameCommand): GameState {
  switch (command.type) {
    case "DRAW": {
      const count = Math.max(0, Math.min(command.count, state.zones.library.length));
      const drawn = state.zones.library.slice(0, count);
      const zones = {
        ...state.zones,
        library: state.zones.library.slice(count),
        hand: [...state.zones.hand, ...drawn],
      };
      return { ...state, zones, log: appendLog(state, `Drew ${count} card${count === 1 ? "" : "s"}.`) };
    }

    case "MOVE_CARD": {
      const card = state.cards[command.cardId];
      if (!card) return state;
      const withoutSource = withoutCard(state.zones, command.cardId);
      const zones = { ...withoutSource, [command.to]: insertAt(withoutSource[command.to], command.cardId, command.index) };
      const groupId = command.to === "battlefield" ? (command.groupId ?? null) : null;
      const cards = { ...state.cards, [command.cardId]: { ...card, groupId } };
      return { ...state, zones, cards, log: appendLog(state, `Moved ${card.name} to ${command.to}.`) };
    }

    case "SET_TAPPED": {
      const card = state.cards[command.cardId];
      if (!card) return state;
      const cards = { ...state.cards, [command.cardId]: { ...card, tapped: command.tapped } };
      return { ...state, cards, log: appendLog(state, `${command.tapped ? "Tapped" : "Untapped"} ${card.name}.`) };
    }

    case "SET_FACE": {
      const card = state.cards[command.cardId];
      if (!card) return state;
      const cards = { ...state.cards, [command.cardId]: { ...card, face: command.face } };
      return { ...state, cards, log: appendLog(state, `Set ${card.name} to ${command.face}.`) };
    }

    case "ADD_COUNTER": {
      const card = state.cards[command.cardId];
      if (!card) return state;
      const nextValue = (card.counters[command.name] ?? 0) + command.delta;
      const counters = { ...card.counters };
      // A counter at exactly zero is dropped rather than kept as an explicit
      // 0 — matches how a player would read the board (no chip, not "0
      // chip") and keeps the negate-delta inverse in inverse.ts exact.
      if (nextValue === 0) delete counters[command.name];
      else counters[command.name] = nextValue;
      const cards = { ...state.cards, [command.cardId]: { ...card, counters } };
      const verb = command.delta >= 0 ? "Added" : "Removed";
      return {
        ...state,
        cards,
        log: appendLog(state, `${verb} ${Math.abs(command.delta)} ${command.name} counter${Math.abs(command.delta) === 1 ? "" : "s"} on ${card.name}.`),
      };
    }

    case "CREATE_TOKEN": {
      const cards = { ...state.cards };
      for (const id of command.ids) {
        const token: GameCard = {
          id,
          kind: "token",
          cardId: null,
          oracleId: null,
          name: command.token.name,
          imageUri: command.token.imageUri,
          face: "front",
          tapped: false,
          rotation: 0,
          counters: {},
          note: null,
          copiedFromId: null,
          groupId: null,
          power: command.token.power,
          toughness: command.token.toughness,
        };
        cards[id] = token;
      }
      const zones = { ...state.zones, [command.zone]: [...state.zones[command.zone], ...command.ids] };
      return {
        ...state,
        cards,
        zones,
        log: appendLog(state, `Created ${command.ids.length} ${command.token.name} token${command.ids.length === 1 ? "" : "s"}.`),
      };
    }

    case "DELETE_OBJECT": {
      const card = state.cards[command.cardId];
      if (!card) return state;
      const zones = withoutCard(state.zones, command.cardId);
      const cards = { ...state.cards };
      delete cards[command.cardId];
      return { ...state, zones, cards, log: appendLog(state, `Removed ${card.name}.`) };
    }

    case "SHUFFLE": {
      const shuffled = shuffleZone(state, command.zone, command.seed);
      return { ...shuffled, log: appendLog(state, `Shuffled ${command.zone}.`) };
    }

    case "SET_LIFE": {
      const life = state.life + command.delta;
      const sign = command.delta >= 0 ? "+" : "";
      return { ...state, life, log: appendLog(state, `Life ${sign}${command.delta} -> ${life}.`) };
    }

    case "NEXT_TURN": {
      const turn = state.turn + 1;
      return { ...state, turn, log: appendLog(state, `Turn ${turn}.`) };
    }

    case "RESTORE_SNAPSHOT": {
      return command.snapshot;
    }

    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
