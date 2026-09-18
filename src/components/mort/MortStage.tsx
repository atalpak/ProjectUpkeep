"use client";

import { useEffect } from "react";

import { mortPalette } from "@/components/mort/palette";
import {
  useMort,
  useMortReaction,
  type MortReaction,
} from "@/components/mort/controller";

// Responsive modes from the brand doc's §26 — xs/s/m map to its
// micro/reaction/character tiers, l to its scene tier. xs has no call site
// yet in this pass (reserved for a future compact use, e.g. a status strip);
// the prop exists so the architecture is right today.
const SIZES: Record<"xs" | "s" | "m" | "l", number> = { xs: 28, s: 88, m: 160, l: 380 };

/**
 * The visual half of the Mort semantic-reaction system (see `controller.ts`
 * for the "why" of the split). Decorative only: `aria-hidden="true"` and
 * never focusable — Mort must never be the sole carrier of information (brand
 * doc §25), and every call site pairs this with real copy.
 *
 * Renders a plain placeholder shape today because no real Mort art exists yet
 * — a future real-asset drop only touches this component's body, not any
 * call site. Mirrors `apps/mobile/src/mort/MortStage.tsx`'s shape.
 *
 * Most call sites want a specific static pose regardless of whatever the
 * global controller last showed (a server-rendered empty state has no
 * "trigger" to react to) — passing `reaction` fires it once on mount so the
 * pose is deterministic per call site, the same way product code anywhere
 * else would call `useMort().react(...)`. Omit it to just display whatever
 * is currently live (e.g. after some other component reacted to a real
 * event).
 *
 * Pose changes cross-fade via a CSS animation keyed to the reaction, rather
 * than JS-driven opacity state — the same pattern `.animate-page-enter` and
 * `.foil-mark` already use in globals.css, and it lets `prefers-reduced-motion`
 * disable the fade with a plain media query instead of a second code path.
 */
export function MortStage({
  size,
  reaction,
  animated = true,
}: {
  size: "xs" | "s" | "m" | "l";
  reaction?: MortReaction;
  /** A visitor who did not opt into ambient motion (the public profile page,
   *  looking at a friend's or a stranger's Mort) gets a static pose — no
   *  cross-fade between poses. Defaults to true everywhere the signed-in
   *  owner is the one looking. */
  animated?: boolean;
}) {
  const { react } = useMort();
  const live = useMortReaction();

  useEffect(() => {
    if (reaction) react(reaction);
    // Only on mount / when a caller changes which static reaction it wants —
    // `react` is stable, not an input to this decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction]);

  const shown = reaction ?? live;
  const dimension = SIZES[size];

  return (
    <div
      aria-hidden="true"
      className="mx-auto flex items-center justify-center"
      style={{ width: dimension, height: dimension }}
    >
      <div
        key={shown}
        className={animated ? "h-full w-full rounded-full animate-mort-pose" : "h-full w-full rounded-full"}
        style={{ backgroundColor: mortPalette.green }}
      />
    </div>
  );
}
