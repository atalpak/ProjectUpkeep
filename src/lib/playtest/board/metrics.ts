/**
 * Numbers for the charts, computed from the structured event log (events.ts).
 *
 * Every chart states its counting convention, because a chart that is quietly
 * measuring something slightly different from what its title says is worse
 * than no chart. The conventions are exported (CONVENTIONS) so the UI prints
 * exactly the text the tests pin.
 *
 * The numbers come from EVENTS, not from replaying commands, because a saved
 * game keeps states and not commands: a value like "power in play at the end
 * of turn 4" can only exist if it was written down at the time, which is why
 * NEXT_TURN records a board summary on its own event (reducers/trackers.ts)
 * and a move to the battlefield records the mana value entering (zones.ts).
 * Voided events (a player's log correction) are excluded, and if the log was
 * trimmed to fit a save the result says so (`partial`) rather than pretending.
 */

import type { GameEvent, GameState } from "./types";

export const CONVENTIONS = {
  drawn: "Cards drawn per turn: every draw, plus the draw taken by Next turn. Mulligan hands are not counted.",
  milled: "Cards milled per turn: cards moved from the top of the library to the graveyard by Mill.",
  playedMv:
    "Mana value played: the printed mana value of each card moved onto the battlefield, from any zone. This is not mana paid: free spells, alternate costs and X are not reflected. Tokens count as 0.",
  producers: "Mana producers: permanents on the battlefield at the start of the turn whose printing can tap for mana. Not mana actually produced.",
  power: "Power in play: printed power plus +1/+1 and -1/-1 counters and manual offsets on battlefield permanents, at the start of the turn. A tally, not a combat calculation.",
} as const;

export type MvFilter = "all" | "creature" | "other";

export type TurnMetrics = {
  turn: number;
  drawn: number;
  milled: number;
  playedMv: Record<MvFilter, number>;
  cardsPlayed: number;
  producers: number | null;
  power: number | null;
};

export type Metrics = {
  turns: TurnMetrics[];
  /** True when older events were trimmed to fit a save. */
  partial: boolean;
  voided: number;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function computeMetrics(events: readonly GameEvent[], eventsTruncatedBefore: number | null = null): Metrics {
  const byTurn = new Map<number, TurnMetrics>();
  const at = (turn: number): TurnMetrics => {
    let row = byTurn.get(turn);
    if (!row) {
      row = { turn, drawn: 0, milled: 0, playedMv: { all: 0, creature: 0, other: 0 }, cardsPlayed: 0, producers: null, power: null };
      byTurn.set(turn, row);
    }
    return row;
  };

  let voided = 0;
  for (const event of events) {
    if (event.voided) {
      voided++;
      continue;
    }
    const row = at(event.turn);
    switch (event.kind) {
      case "draw":
        row.drawn += num(event.data.count);
        break;
      case "mill":
        row.milled += num(event.data.count);
        break;
      case "move":
        if (event.to === "battlefield" && event.data.mv !== undefined) {
          const mv = num(event.data.mv);
          const creature = num(event.data.mvCreature);
          row.playedMv.all += mv;
          row.playedMv.creature += creature;
          row.playedMv.other += mv - creature;
          row.cardsPlayed += num(event.data.nCreature) + num(event.data.nLand) + num(event.data.nOther);
        }
        break;
      case "turn":
        row.drawn += num(event.data.drew);
        if (event.data.power !== undefined) row.power = num(event.data.power);
        if (event.data.producers !== undefined) row.producers = num(event.data.producers);
        break;
      default:
        break;
    }
  }
  const turns = [...byTurn.values()].sort((a, b) => a.turn - b.turn);
  return { turns, partial: eventsTruncatedBefore !== null, voided };
}

/** Plain-language warnings about the record, shown next to the log/charts. */
export function logWarnings(state: GameState): string[] {
  const warnings: string[] = [];
  const voided = state.events.filter((e) => e.voided).length;
  if (voided > 0) {
    warnings.push(`${voided} log ${voided === 1 ? "entry was" : "entries were"} removed by hand. The log and charts may no longer match the board.`);
  }
  if (state.eventsTruncatedBefore !== null) {
    warnings.push("The earliest part of this game's log was trimmed to fit a save, so charts only cover the later turns.");
  }
  return warnings;
}
