/**
 * Browser-local crash recovery, as PURE helpers. The actual `localStorage`
 * reads and writes live in the UI hook (components/playtester/hooks/); this
 * module owns everything that can be decided without a browser: the key
 * names, the envelope format, how a stored blob is validated, the small LRU
 * index, and which keys belong to somebody else.
 *
 * Why the rules are what they are:
 *
 *  - Keys carry the USER id (`upkeep:playtest:v2:<userId>:<deckId>`), because
 *    a browser is shared: signing out and in as someone else must never offer
 *    them the previous person's game. The sign-out form clears every
 *    `upkeep:playtest:` key, and the play page also deletes any key naming a
 *    different user on load, which covers an expired session, another tab and
 *    an account deleted elsewhere.
 *  - The index keeps at most five decks, least-recently-saved evicted first,
 *    so a heavy user's storage cannot grow without bound (each game is ~50-90KB
 *    of the ~5MB a browser gives an origin).
 *  - A stored game that fails validation, or names another deck, is DELETED
 *    with a notice rather than offered: an offer to resume a corrupt game is a
 *    crash waiting to happen.
 *  - Two tabs on one deck: last writer wins. Documented, not solved.
 *
 * The envelope carries the deck fingerprint so the resume prompt can offer
 * "Continue saved state / Start with current deck", and the linked account
 * session (id + the `updated_at` last seen) so an overwrite can detect that
 * another tab changed it.
 */

import { validateSnapshot, SnapshotValidationError } from "./board/serialize";
import type { GameState } from "./board/types";

export const KEY_PREFIX = "upkeep:playtest:";
export const ENVELOPE_VERSION = 1;
export const MAX_DECKS = 5;

export const gameKey = (userId: string, deckId: string) => `${KEY_PREFIX}v2:${userId}:${deckId}`;
export const indexKey = (userId: string) => `${KEY_PREFIX}index:${userId}`;
export const prefsKey = (userId: string) => `${KEY_PREFIX}prefs:v1:${userId}`;

export type Envelope = {
  version: number;
  savedAt: number;
  fingerprint: string;
  sessionId: string | null;
  sessionUpdatedAt: string | null;
  snapshot: unknown;
};

export function buildEnvelope(state: GameState, savedAt: number, link: { sessionId: string | null; sessionUpdatedAt: string | null }): string {
  const envelope: Envelope = {
    version: ENVELOPE_VERSION,
    savedAt,
    fingerprint: state.source.fingerprint,
    sessionId: link.sessionId,
    sessionUpdatedAt: link.sessionUpdatedAt,
    snapshot: state,
  };
  return JSON.stringify(envelope);
}

export type ParsedEnvelope =
  | { status: "ok"; state: GameState; savedAt: number; fingerprint: string; sessionId: string | null; sessionUpdatedAt: string | null }
  | { status: "invalid"; reason: string }
  | { status: "wrong-deck" };

export function parseEnvelope(raw: string, deckId: string): ParsedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "The stored game is not readable." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { status: "invalid", reason: "The stored game is not readable." };
  const env = parsed as Record<string, unknown>;
  if (env.version !== ENVELOPE_VERSION || typeof env.savedAt !== "number" || !Number.isFinite(env.savedAt)) {
    return { status: "invalid", reason: "The stored game is from an unknown version." };
  }
  let state: GameState;
  try {
    state = validateSnapshot(env.snapshot);
  } catch (err) {
    if (err instanceof SnapshotValidationError) return { status: "invalid", reason: err.message };
    throw err;
  }
  if (state.deckId !== deckId) return { status: "wrong-deck" };
  return {
    status: "ok",
    state,
    savedAt: env.savedAt,
    fingerprint: state.source.fingerprint,
    sessionId: typeof env.sessionId === "string" ? env.sessionId : null,
    sessionUpdatedAt: typeof env.sessionUpdatedAt === "string" ? env.sessionUpdatedAt : null,
  };
}

export type RecoveryIndex = { decks: Array<{ deckId: string; savedAt: number }> };

export function parseIndex(raw: string | null): RecoveryIndex {
  if (!raw) return { decks: [] };
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return { decks: [] };
    const decks = (value as { decks?: unknown }).decks;
    if (!Array.isArray(decks)) return { decks: [] };
    return {
      decks: decks
        .filter((d): d is { deckId: string; savedAt: number } => typeof d === "object" && d !== null && typeof (d as { deckId?: unknown }).deckId === "string" && typeof (d as { savedAt?: unknown }).savedAt === "number")
        .slice(0, MAX_DECKS + 5),
    };
  } catch {
    return { decks: [] };
  }
}

/** Records a save for a deck and returns the decks to evict (their game keys
 *  should be removed) so the index never exceeds `MAX_DECKS`. */
export function touchIndex(index: RecoveryIndex, deckId: string, savedAt: number): { index: RecoveryIndex; evicted: string[] } {
  const others = index.decks.filter((d) => d.deckId !== deckId);
  const decks = [{ deckId, savedAt }, ...others].sort((a, b) => b.savedAt - a.savedAt);
  return { index: { decks: decks.slice(0, MAX_DECKS) }, evicted: decks.slice(MAX_DECKS).map((d) => d.deckId) };
}

export function dropFromIndex(index: RecoveryIndex, deckId: string): RecoveryIndex {
  return { decks: index.decks.filter((d) => d.deckId !== deckId) };
}

/** Which of the keys present in storage belong to a user other than `userId`,
 *  or to nobody we can identify: all of them are deleted on load. */
export function foreignKeys(allKeys: readonly string[], userId: string): string[] {
  const own = new Set([`${KEY_PREFIX}index:${userId}`, `${KEY_PREFIX}prefs:v1:${userId}`]);
  const gamePrefix = `${KEY_PREFIX}v2:${userId}:`;
  return allKeys.filter((key) => key.startsWith(KEY_PREFIX) && !own.has(key) && !key.startsWith(gamePrefix));
}

/** Every recovery key, for the sign-out form to clear. */
export function allPlaytestKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter((key) => key.startsWith(KEY_PREFIX));
}

export function minutesAgo(savedAt: number, now: number): number {
  return Math.max(0, Math.round((now - savedAt) / 60000));
}

/** "Continue your game from 12 minutes ago?" */
export function agoText(savedAt: number, now: number): string {
  const minutes = minutesAgo(savedAt, now);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Throttle policy: write 1s after the last change, but never wait more than
 *  5s while changes keep arriving. Returns the delay to schedule, or 0 to
 *  write now. */
export function nextWriteDelay(now: number, firstUnsavedChange: number | null): number {
  const quiet = 1000;
  const ceiling = 5000;
  if (firstUnsavedChange === null) return quiet;
  const waited = now - firstUnsavedChange;
  if (waited >= ceiling) return 0;
  return Math.min(quiet, ceiling - waited);
}
