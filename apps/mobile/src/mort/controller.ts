import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { duration as DURATION } from '../theme';

/**
 * Semantic reaction API — decoupled from asset filenames, per the brand
 * handoff doc's "Animation Event Architecture" (§22): product code triggers
 * a semantic Mort reaction, the platform decides how it renders. Mort art
 * assets do not exist yet (owner decision), so `loadPoseAsset` below always
 * resolves `null` today and `MortStage` renders a placeholder — nothing
 * about this module's public shape changes once real poses land.
 */
export type MortReaction = 'idle' | 'look' | 'scan' | 'scan_success' | 'scan_uncertain' | 'file' | 'annoyed';

// How long a reaction holds before falling back to idle, absent an
// interrupting react() call. 'idle' and 'scan' are deliberately absent:
// idle has nothing to fall back FROM, and scan has no fixed duration at all
// — see ScanScreen's capture(), which calls react('scan') then transitions
// out the instant pipeline.scan() actually resolves, never on a timer (the
// brand doc's "the system must not wait for Mort before producing a scan
// result" rule, §14/§16).
const HOLD_MS: Partial<Record<MortReaction, number>> = {
  look: DURATION.react,
  scan_success: DURATION.react,
  scan_uncertain: DURATION.reactLong,
  file: DURATION.file,
  annoyed: DURATION.react,
};

// Reduced motion holds every timed reaction for a fixed duration instead of
// the tier-specific one above — the pose is a state marker at that point,
// not a performance, so the exact hold length no longer needs to vary by
// reaction.
const REDUCED_MOTION_HOLD_MS = 2000;

type Listener = () => void;
let currentReaction: MortReaction = 'idle';
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

function clearHold() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}

/**
 * Any new call interrupts whatever is currently showing — there is no
 * animation queue. Two reactions racing resolve to "whichever called
 * react() last", which is what makes 'scan' win over 'look': every call site
 * that races them (ScanScreen.capture()) fires look() immediately followed
 * by scan(), so scan is always the final, winning call.
 */
function applyReaction(reaction: MortReaction, reducedMotion: boolean) {
  clearHold();
  currentReaction = reaction;
  notify();
  const tierHold = HOLD_MS[reaction];
  if (tierHold === undefined) return; // holds until interrupted by another react()
  const ms = reducedMotion ? REDUCED_MOTION_HOLD_MS : tierHold;
  holdTimer = setTimeout(() => { currentReaction = 'idle'; notify(); }, ms);
}

/**
 * The hook call sites use to fire a reaction, e.g. `useMort().react('scan')`.
 * Fire-and-forget by contract — callers never await it, because there is
 * nothing to await; the effect is a module-level state change other
 * subscribers (MortStage) pick up via useMortReaction.
 */
export function useMort() {
  const reducedMotion = useReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  return {
    react(reaction: MortReaction) {
      applyReaction(reaction, reducedRef.current);
    },
  };
}

/** Internal — the subscription MortStage uses to render the live reaction. */
export function useMortReaction(): MortReaction {
  const [reaction, setReaction] = useState(currentReaction);
  useEffect(() => {
    const listener = () => setReaction(currentReaction);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return reaction;
}

/**
 * Lazy-loaded inside this module (not imported at App.tsx's top level) so a
 * future real-asset drop only touches this function's body. Each pose can
 * render null / a placeholder until then — the point of this phase is that
 * the call sites and timing are correct, not that the art exists.
 */
export async function loadPoseAsset(_reaction: MortReaction): Promise<unknown | null> {
  return null;
}
