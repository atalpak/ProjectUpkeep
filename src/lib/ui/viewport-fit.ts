/**
 * Where a dropdown panel has to move so it stays inside the window.
 *
 * Most menus in the app are `position: absolute; right: 0; top: 100%` under
 * their trigger. That is right only while the trigger is near the right edge
 * and there is room below it: a trigger further left pushes a 14rem panel off
 * the left edge, and a trigger low on the screen pushes the bottom items
 * below the fold with nothing to scroll them into reach. The panel cannot
 * know either, so the hook in `src/hooks/useViewportFit.ts` measures it after
 * layout and asks this function what to do. Kept pure (plain boxes in, plain
 * numbers out) so the edge cases are testable without a browser.
 *
 * The answer is a translation plus an optional height cap, not new
 * `top`/`left` values, so it works the same for an absolutely positioned panel
 * and a `fixed` portalled one (`FloatingMenu`) without knowing which it has.
 */

export type Box = { top: number; left: number; right: number; bottom: number };

export type Fit = {
  /** Pixels to move the panel horizontally. */
  dx: number;
  /** Pixels to move it vertically; negative when it flips above its trigger. */
  dy: number;
  /** Cap the panel's height (and let it scroll) at this many px, or null for none. */
  maxHeight: number | null;
};

/** Never squeeze a scrolling panel below about three rows. */
const MIN_HEIGHT = 96;

export function fitToViewport(
  panel: Box,
  anchor: Box | null,
  viewport: { width: number; height: number },
  margin = 8,
): Fit {
  const width = panel.right - panel.left;
  const height = panel.bottom - panel.top;

  // Horizontal: pull back inside, left edge winning when the panel is wider
  // than the window (its own max-width is the caller's job; this only makes
  // sure the start of each row stays readable).
  let dx = 0;
  if (width > viewport.width - 2 * margin || panel.left < margin) dx = margin - panel.left;
  else if (panel.right > viewport.width - margin) dx = viewport.width - margin - panel.right;

  const below = viewport.height - margin - panel.top;
  if (height <= below) return { dx, dy: 0, maxHeight: null };

  // No trigger to flip around: keep it where it is and let it scroll.
  if (!anchor) return { dx, dy: 0, maxHeight: Math.max(below, MIN_HEIGHT) };

  const gap = Math.max(0, panel.top - anchor.bottom);
  const above = anchor.top - gap - margin;
  if (above <= below) return { dx, dy: 0, maxHeight: Math.max(below, MIN_HEIGHT) };

  // More room above than below: hang from the trigger's top edge instead.
  const capped = Math.min(height, above);
  return {
    dx,
    dy: -(capped + (anchor.bottom - anchor.top) + 2 * gap),
    maxHeight: capped < height ? capped : null,
  };
}
