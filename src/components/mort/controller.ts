"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Semantic reaction API — decoupled from asset filenames, per the brand
 * handoff doc's "Animation Event Architecture" (§22): product code triggers
 * a semantic Mort reaction, the platform decides how it renders. No real
 * Mort art exists yet (owner decision), so `loadPoseAsset` below always
 * resolves `null` today and `MortStage` renders a placeholder — nothing
 * about this module's public shape changes once real poses land.
 *
 * Mirrors `apps/mobile/src/mort/controller.ts` in shape. The web reaction set
 * is the fuller one from the brand doc's suggested state model (§20) rather
 * than the mobile app's scan-only subset, since the web surfaces (empty
 * states, decks, trades) this pass wires up span more of the product than
 * the mobile scanner does today.
 */
export type MortReaction =
  | "idle"
  | "look"
  | "annoyed"
  | "file"
  | "duplicate"
  | "missing"
  | "deck_complete"
  | "trade_match"
  | "trade_complete"
  | "celebrate"
  | "sleep";

// How long a reaction holds before falling back to idle, absent an
// interrupting react() call. Reactions with no entry here hold until
// something else calls react() — there is no fixed "this pose is over" point
// for them (e.g. a static empty-state pose that lives as long as the empty
// state does).
const HOLD_MS: Partial<Record<MortReaction, number>> = {
  look: 900,
  annoyed: 900,
  file: 900,
  duplicate: 900,
  trade_match: 900,
  celebrate: 2400,
};

// Reduced motion holds every timed reaction for the same fixed duration
// instead of the tier-specific one above — the pose is a state marker at
// that point, not a performance, so the exact hold length no longer needs to
// vary by reaction. See brand doc §25.
const REDUCED_MOTION_HOLD_MS = 2000;

type Listener = () => void;
let currentReaction: MortReaction = "idle";
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

function clearHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

/**
 * Any new call interrupts whatever is currently showing — there is no
 * animation queue (brand doc §23: "do not queue a long backlog of mascot
 * animations"). Two reactions racing resolve to "whichever called react()
 * last".
 */
function applyReaction(reaction: MortReaction, reducedMotion: boolean) {
  clearHold();
  currentReaction = reaction;
  notify();
  const tierHold = HOLD_MS[reaction];
  if (tierHold === undefined) return; // holds until interrupted by another react()
  const ms = reducedMotion ? REDUCED_MOTION_HOLD_MS : tierHold;
  holdTimer = setTimeout(() => {
    currentReaction = "idle";
    notify();
  }, ms);
}

/**
 * The hook call sites use to fire a reaction, e.g. `useMort().react("file")`.
 * Fire-and-forget by contract — callers never await it, because there is
 * nothing to await; the effect is a module-level state change other
 * subscribers (`MortStage`) pick up via `useMortReaction`.
 */
export function useMort() {
  const reducedMotion = useReducedMotion();
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);
  return {
    react(reaction: MortReaction) {
      applyReaction(reaction, reducedRef.current);
    },
  };
}

/** Internal — the subscription `MortStage` uses to render the live reaction. */
export function useMortReaction(): MortReaction {
  const [reaction, setReaction] = useState(currentReaction);
  useEffect(() => {
    const listener = () => setReaction(currentReaction);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return reaction;
}

/**
 * Lazy-loaded inside this module (not imported at any page's top level) so a
 * future real-asset drop only touches this function's body. Each pose can
 * render null / a placeholder until then — the point of this phase is that
 * the call sites and timing are correct, not that the art exists.
 */
export async function loadPoseAsset(_reaction: MortReaction): Promise<unknown | null> {
  return null;
}
