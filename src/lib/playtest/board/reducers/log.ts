/**
 * Event recording, shared by every reducer. The context carries what the
 * reducer cannot compute purely: the wall-clock `ts` (set by the browser
 * store, 0 in tests, so replaying commands is byte-identical) and the
 * `gesture` id that ties the events of one command together.
 */

import { LIMITS, type EventData, type EventKind, type GameEvent, type GameState, type ZoneId } from "../types";

export type Ctx = { ts: number; gesture: number };

export type EventInput = {
  kind: EventKind;
  ids?: string[];
  names?: string[];
  from?: ZoneId | null;
  to?: ZoneId | null;
  data?: EventData;
  private?: boolean;
};

export function addEvent(state: GameState, ctx: Ctx, input: EventInput): GameState {
  const event: GameEvent = {
    seq: state.nextEventSeq,
    gestureId: ctx.gesture,
    turn: state.turn,
    ts: ctx.ts,
    kind: input.kind,
    ids: input.ids ?? [],
    names: input.names ?? [],
    from: input.from ?? null,
    to: input.to ?? null,
    data: input.data ?? {},
    voided: false,
    private: input.private ?? false,
  };
  let events = [...state.events, event];
  let truncated = state.eventsTruncatedBefore;
  if (events.length > LIMITS.events) {
    events = events.slice(events.length - LIMITS.events);
    truncated = events[0].seq;
  }
  return { ...state, events, nextEventSeq: state.nextEventSeq + 1, eventsTruncatedBefore: truncated };
}

/** Sets or clears the voided flag on one event. The board is untouched: a log
 *  correction is a statement about the record, not an undo. */
export function voidEvent(state: GameState, seq: number, voided: boolean): GameState {
  if (!state.events.some((e) => e.seq === seq)) return state;
  return { ...state, events: state.events.map((e) => (e.seq === seq ? { ...e, voided } : e)) };
}
