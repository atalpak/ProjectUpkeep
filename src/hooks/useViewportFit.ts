"use client";

import { useLayoutEffect, type RefObject } from "react";

import { fitToViewport } from "@/lib/ui/viewport-fit";

/**
 * Keeps an open dropdown panel inside the window: shifts it sideways, flips it
 * above its trigger, or caps its height and lets it scroll, whichever the
 * position it would otherwise open at needs. The decision is
 * `fitToViewport`'s; this is only the measuring and the inline styles.
 *
 * Styles are written straight to the element rather than through state: the
 * panel has already been laid out at its natural position by the time this
 * runs, and a `useLayoutEffect` write lands before paint, so there is no
 * frame at the wrong place and no second render.
 *
 * `anchorRef` is the trigger to flip around and every caller should pass it.
 * The fallback, the panel's `offsetParent`, is only the trigger's box when the
 * `relative` wrapper holds nothing but the trigger; a taller wrapper would put
 * the flip in the wrong place. A `fixed` portalled panel has no offsetParent at
 * all, so `FloatingMenu` passes its trigger.
 *
 * `refitKey` is for callers whose panel is placed by their own state (a
 * measured position that arrives a render late). Size changes of the panel
 * itself, such as an async list filling in, are picked up by a ResizeObserver.
 */
export function useViewportFit(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  anchorRef?: RefObject<HTMLElement | null>,
  refitKey?: unknown,
): void {
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!active || !el) return;

    function fit(panel: HTMLElement) {
      // Back to the natural position first, so the measurement never includes
      // the previous fit.
      panel.style.transform = "";
      panel.style.maxHeight = "";
      panel.style.overflowY = "";
      // A transform the panel already has from its classes (a `-translate-*`)
      // is composed with, not replaced: with the inline one cleared this reads
      // the stylesheet's value.
      const own = getComputedStyle(panel).transform;

      const anchor = anchorRef?.current ?? panel.offsetParent;
      const result = fitToViewport(
        panel.getBoundingClientRect(),
        anchor ? anchor.getBoundingClientRect() : null,
        { width: window.innerWidth, height: window.innerHeight },
      );

      if (result.maxHeight !== null) {
        panel.style.maxHeight = `${result.maxHeight}px`;
        panel.style.overflowY = "auto";
      }
      if (result.dx !== 0 || result.dy !== 0) {
        panel.style.transform = `translate(${result.dx}px, ${result.dy}px)${own && own !== "none" ? ` ${own}` : ""}`;
      }
    }

    fit(el);
    const onResize = () => fit(el);
    window.addEventListener("resize", onResize);
    // An absolute panel scrolls with the page, so how much room is left below
    // its trigger changes as the page moves.
    window.addEventListener("scroll", onResize, true);
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      observer.disconnect();
    };
  }, [active, panelRef, anchorRef, refitKey]);
}
