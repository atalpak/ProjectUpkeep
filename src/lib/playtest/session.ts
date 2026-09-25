/**
 * Pure helpers for saved games and shares: titles, the small `preview` shown in
 * the saved-games list, the size caps, and the shape server actions return.
 * Nothing here talks to a database; the server actions
 * (`src/app/(app)/decks/[id]/play/actions.ts`) call these on data they have
 * already validated, so the rules that decide what may be saved live in one
 * testable place instead of being spread across action bodies.
 *
 * The caps mirror the database CHECK constraints in migrations 46 and 47 on
 * purpose: an action rejects an oversize save BEFORE it reaches the database
 * (a friendlier message, and no wasted round trip), and the constraint is the
 * backstop for anything that reaches the table another way.
 */

import { fitForSave } from "./board/serialize";
import type { GameState } from "./board/types";

/** 256KB, the `playtest_sessions.snapshot` CHECK (text length, not storage). */
export const MAX_SNAPSHOT_CHARS = 262144;
/** 128KB, the `playtest_shares.projection` CHECK. */
export const MAX_PROJECTION_CHARS = 131072;
export const MAX_TITLE = 100;
export const MAX_PREVIEW_CHARS = 2048;

export type ActionResult<T extends object = object> =({ ok: true } & T) | { ok: false; message: string };

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  sourceFingerprint: string;
  preview: SessionPreview;
};

export type SessionPreview = {
  turn: number;
  life: number;
  format: string;
  hand: number;
  library: number;
  battlefield: number;
  graveyard: number;
  exile: number;
  command: number;
};

/** What the play page hands the client: the caller's saves and shares for one
 *  deck, or `available: false` when the tables do not exist yet. */
export type SavesSummary = {
  available: boolean;
  sessions: SessionSummary[];
  shares: ShareSummary[];
};

export type ShareSummary = {
  id: string;
  token: string;
  title: string;
  showHand: boolean;
  expiresAt: string;
  updatedAt: string;
};

/** Trim, collapse runs of whitespace, cap at 100. Null when nothing is left. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_TITLE).trim();
}

/** "<title> (copy)", cutting the BASE title so the suffix always survives. */
export function copyTitle(title: string): string {
  const suffix = " (copy)";
  return `${title.slice(0, MAX_TITLE - suffix.length).trimEnd()}${suffix}`;
}

/** Built from validated state on the server; never taken from the client. */
export function buildPreview(state: GameState): SessionPreview {
  return {
    turn: state.turn,
    life: state.trackers.life,
    format: state.config.format,
    hand: state.zones.hand.length,
    library: state.zones.library.length,
    battlefield: state.zones.battlefield.length,
    graveyard: state.zones.graveyard.length,
    exile: state.zones.exile.length,
    command: state.zones.command.length,
  };
}

export function previewLine(preview: SessionPreview): string {
  const turn = preview.turn === 0 ? "Opening hand" : `Turn ${preview.turn}`;
  return `${turn} · ${preview.life} life · ${preview.hand} in hand · ${preview.battlefield} on the table`;
}

/** Reads a stored preview defensively: it came out of a jsonb column. */
export function readPreview(value: unknown): SessionPreview {
  const r = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
  return {
    turn: n(r.turn),
    life: n(r.life),
    format: typeof r.format === "string" ? r.format.slice(0, 20) : "constructed",
    hand: n(r.hand),
    library: n(r.library),
    battlefield: n(r.battlefield),
    graveyard: n(r.graveyard),
    exile: n(r.exile),
    command: n(r.command),
  };
}

export type PreparedSave = { canonical: string; state: GameState; preview: SessionPreview } | { error: string };

/**
 * Turns an already-VALIDATED state into what a save stores: the log trimmed to
 * fit if it must be, the canonical JSON, and the server-computed preview.
 * Returns an error string (plain wording) when even a trimmed log will not fit,
 * so the action can refuse before touching the database.
 */
export function prepareSave(state: GameState): PreparedSave {
  const fitted = fitForSave(state);
  const canonical = JSON.stringify(fitted);
  if (canonical.length > MAX_SNAPSHOT_CHARS) {
    return { error: "This game is too large to save. Try removing extra tokens or cards first." };
  }
  return { canonical, state: fitted, preview: buildPreview(fitted) };
}
