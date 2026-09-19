/**
 * The live coaching line above quick scan's camera box ("Move closer", "Hold
 * steady"). The native scanner reports what it sees (`onScanStatus`, only on
 * change) and this file turns that stream into text a person can read: a message
 * stays up for at least `STATUS_MIN_MS`, because a hint that flickers at the
 * detector's frame rate is worse than none.
 *
 * Pure, with the clock passed in, so the pacing is tested like the rest of
 * scan-core. The native enum lives in packages/upkeep-vision
 * (`ScanStatus` in UpkeepCardVision.swift); keep the two in step.
 */

export const SCAN_STATUSES = ['searching', 'far', 'partial', 'moving', 'blurry', 'reading'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export function isScanStatus(value: unknown): value is ScanStatus {
  return typeof value === 'string' && (SCAN_STATUSES as readonly string[]).includes(value);
}

export const SCAN_STATUS_TEXT: Record<ScanStatus, string> = {
  searching: 'Hold a card up to the camera',
  far: 'Move closer',
  partial: 'Show the whole card',
  moving: 'Hold steady',
  blurry: 'Hold steady, focusing…',
  // The card is locked and the details sheet is about to open: the only
  // useful instruction left is not to move it.
  reading: 'Hold steady',
};

/** Fewest milliseconds one message stays on screen before another replaces it. */
export const STATUS_MIN_MS = 400;

/** How actionable a message is: when several arrive inside one hold, the higher wins. */
const ACTIONABLE: Record<ScanStatus, number> = { searching: 0, far: 1, partial: 2, moving: 3, blurry: 4, reading: 5 };

export interface PacerState {
  shown: ScanStatus;
  shownAt: number;
  /** What will replace `shown` when the hold ends. */
  queued: ScanStatus | null;
  /** The newest thing native said: the truth the queue must end up at. */
  latest: ScanStatus;
}

export function initialPacer(now = 0): PacerState {
  return { shown: 'searching', shownAt: now, queued: null, latest: 'searching' };
}

export interface PacerStep {
  state: PacerState;
  /** Call `flushStatus` after this many ms; null when nothing is pending. */
  waitMs: number | null;
}

/**
 * A status arrived from native. `reading` is never held back (the details sheet
 * is about to open); anything else replaces the shown message at once if it has
 * been up for the minimum, and otherwise waits for the rest of the hold, keeping
 * the most actionable of what arrived meanwhile.
 */
export function paceStatus(state: PacerState, incoming: ScanStatus, now: number): PacerStep {
  const latest = incoming;
  if (incoming === state.shown) return { state: { ...state, latest, queued: null }, waitMs: null };
  const held = now - state.shownAt;
  if (incoming === 'reading' || held >= STATUS_MIN_MS) {
    return { state: { shown: incoming, shownAt: now, queued: null, latest }, waitMs: null };
  }
  const queued = state.queued !== null && ACTIONABLE[state.queued] > ACTIONABLE[incoming] ? state.queued : incoming;
  return { state: { ...state, queued, latest }, waitMs: STATUS_MIN_MS - held };
}

/**
 * The hold ended. Shows what was queued; if native has moved on to something
 * else since (the queue preferred a more actionable message that has now
 * passed), schedules one more hold to reach it, so the text can never stay on a
 * state that is over.
 */
export function flushStatus(state: PacerState, now: number): PacerStep {
  const shown = state.queued ?? state.shown;
  const next: PacerState = { shown, shownAt: now, queued: null, latest: state.latest };
  if (state.latest !== shown) return { state: { ...next, queued: state.latest }, waitMs: STATUS_MIN_MS };
  return { state: next, waitMs: null };
}
