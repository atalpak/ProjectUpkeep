"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useViewportFit } from "@/hooks/useViewportFit";
import { cx } from "@/lib/cx";

/**
 * A trigger and a dropdown panel, for the "⋯" row menus in `CollectionTable`
 * and `WantListManager`.
 *
 * Both of those used to be `position: absolute` inside a `position: relative`
 * row, which is fine until the row sits inside a table wrapped in
 * `overflow-x-auto` (both of them do, for the horizontal scroll a wide table
 * needs on a narrow screen) — that ancestor clips the panel to the table's own
 * box, so a menu opened near the right edge or the bottom of the visible rows
 * got cut off mid-item instead of overlapping the page around it.
 *
 * This portals the panel into `document.body` and positions it with `fixed`
 * coordinates read off the trigger's own `getBoundingClientRect()`, so it
 * escapes whatever ancestor it was opened inside rather than being clipped by
 * it. Its own file rather than living in ui.tsx for the same reason Dialog
 * does: it needs hooks, and ui.tsx is imported directly by Server Components.
 *
 * The trigger render prop is handed a ref callback to attach to whatever
 * element it renders (`<button ref={ref}>`), rather than this component
 * wrapping the trigger in a measuring element of its own. A first version did
 * exactly that, with a `<span className="contents">` around `trigger(...)` —
 * `display: contents` was meant to keep it invisible to layout, but a
 * `contents` box also has no rect of its own: `getBoundingClientRect()` on it
 * always comes back `{0,0,0,0}`, regardless of where its children actually
 * render. Every panel opened at that coordinate instead of by the trigger,
 * which from the trigger's own hit-testing looked like the menu simply
 * wasn't responding to clicks.
 */
export function FloatingMenu({
  trigger,
  children,
  align = "right",
  panelClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Renders the trigger element. Attach `setTriggerRef` to it (as its `ref` prop) — that's what gets measured. */
  trigger: (state: {
    open: boolean;
    toggle: () => void;
    setTriggerRef: (el: HTMLElement | null) => void;
  }) => ReactNode;
  /** Renders the panel's contents. `close` closes the menu, for menu items to call after acting. */
  children: (state: { close: () => void }) => ReactNode;
  /** Which edge of the trigger the panel hangs from. */
  align?: "left" | "right";
  panelClassName?: string;
  /**
   * Uncontrolled by default (open/close state lives here). Pass both `open`
   * and `onOpenChange` for a caller that needs to know about or drive the
   * open state itself — `WantCardMenu` closes whichever one of its menus is
   * open when another one opens, which needs the state a level up.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [coords, setCoords] = useState<{ top: number; left: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The panel is `fixed` under the trigger, which knows nothing about the
  // window's edges: a trigger low on the screen or a wide panel would run off
  // it. Refitted whenever the trigger is re-measured (scroll, resize).
  useViewportFit(open && coords !== null, panelRef, triggerRef, coords);

  const setOpen = (value: boolean) => (onOpenChange ?? setUncontrolledOpen)(value);
  const close = () => setOpen(false);
  const toggle = () => setOpen(!open);
  const setTriggerRef = (el: HTMLElement | null) => {
    triggerRef.current = el;
  };

  // Re-measured on open, and kept in sync while open: a scroll of the table
  // underneath (the very thing the portal exists to not be clipped by) would
  // otherwise leave the panel hovering over where the trigger used to be.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({ top: rect.bottom, left: rect.left, right: window.innerWidth - rect.right });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // `close` is intentionally left out: it closes over `setOpen`, which is a
    // fresh function every render (its own `onOpenChange ?? setUncontrolledOpen`
    // check), so including it would tear this listener down and rebuild it on
    // every render instead of once per open. `open` alone is what should
    // re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {/* `setTriggerRef` only ever reaches a JSX `ref={setTriggerRef}` inside the
         caller's `trigger` render prop; the lint rule can't see across that
         indirection and treats the ref as having "escaped" render, but it
         never runs during render itself — React calls it after commit, like
         any ref callback. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {trigger({ open, toggle, setTriggerRef })}
      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                top: coords.top + 4,
                ...(align === "right" ? { right: coords.right } : { left: coords.left }),
              }}
              className={cx("z-50", panelClassName)}
            >
              {children({ close })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
