/**
 * Log exports: a compact readable text log and a versioned JSON log.
 *
 * Both come in two flavours and the difference is the whole point:
 *
 *  - `private` (the owner's own record): every event, including peeks and the
 *    names of cards drawn. Never uploaded anywhere by this code.
 *  - `shareable`: only `publicEvents()`, the same filter the share projection
 *    uses, so an exported file cannot say more than the share page does. Draws
 *    and mills are counts, hidden cards lose their names, seeds are stripped.
 *
 * The JSON carries `version` so a future reader can tell formats apart, and the
 * text is derived from the same events (describeEvent), never stored.
 */

import { describeEvent, publicEvents } from "./events";
import type { GameEvent, GameState } from "./types";

export const LOG_EXPORT_VERSION = 1;

export type ExportAudience = "private" | "shareable";

function selectEvents(state: GameState, audience: ExportAudience): GameEvent[] {
  if (audience === "shareable") return publicEvents(state.events);
  return state.events.filter((e) => !e.voided);
}

/** "Turn 3" headings, one line per event, in order. */
export function compactLog(state: GameState, audience: ExportAudience): string {
  const events = selectEvents(state, audience);
  const lines: string[] = [];
  let currentTurn: number | null = null;
  for (const event of events) {
    if (event.turn !== currentTurn) {
      if (lines.length > 0) lines.push("");
      lines.push(event.turn === 0 ? "Opening hand" : `Turn ${event.turn}`);
      currentTurn = event.turn;
    }
    lines.push(`- ${describeEvent(event)}`);
  }
  if (state.eventsTruncatedBefore !== null) lines.unshift("(Earlier turns were trimmed to fit a save.)", "");
  return lines.join("\n");
}

export type ExportedLog = {
  version: number;
  kind: "upkeep-playtest-log";
  audience: ExportAudience;
  format: string;
  turn: number;
  partial: boolean;
  events: Array<Partial<GameEvent> & { seq: number; turn: number; kind: string; text: string }>;
};

export function fullLogJson(state: GameState, audience: ExportAudience): ExportedLog {
  const events = selectEvents(state, audience).map((e) => {
    const base = { seq: e.seq, gestureId: e.gestureId, turn: e.turn, kind: e.kind, text: describeEvent(e), data: e.data };
    // The shareable file never carries object ids or seeds (publicEvents
    // already emptied ids and whitelisted data); the private one keeps them
    // so the owner can rebuild metrics later.
    return audience === "shareable"
      ? { ...base, names: e.names, from: e.from, to: e.to }
      : { ...base, names: e.names, ids: e.ids, from: e.from, to: e.to, ts: e.ts };
  });
  return {
    version: LOG_EXPORT_VERSION,
    kind: "upkeep-playtest-log",
    audience,
    format: state.config.format,
    turn: state.turn,
    partial: state.eventsTruncatedBefore !== null,
    events,
  };
}
