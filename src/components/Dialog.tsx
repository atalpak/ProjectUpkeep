"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * The one <dialog> primitive behind every modal in the app.
 *
 * Four places used to hand-roll the same native `<dialog>` + `showModal()` +
 * backdrop-click wiring, each with a small, accidental difference from the
 * others: the new-location picker, the card detail sheet, the nav drawer,
 * the feedback form. This is that wiring, written once.
 *
 * Its own file rather than living directly in ui.tsx: it is the only
 * primitive there that needs hooks, and ui.tsx is imported straight into
 * Server Components (the dashboard, for one) for the primitives that do not.
 * Marking the whole file "use client" would drag Button, Card and the rest
 * into the client bundle along with it, so ui.tsx re-exports this instead —
 * the same shape it already uses for `cx` from its own module.
 *
 * Two ways a dialog can live in the tree, both real, not hypothetical:
 *
 *   - `keepMounted` false (the default) — rendered only while `open` is true,
 *     the shape the new-location picker and the card sheet used. `showModal()`
 *     fires from the ref callback that creates the element rather than from an
 *     effect: an effect runs after the conditional render has already
 *     committed, which is a frame of the `<dialog>` sitting on the page as a
 *     plain unstyled block before it is promoted to the top layer.
 *   - `keepMounted` true — always rendered, opened and closed by an effect
 *     watching `open`, the shape the nav drawer and the feedback form used.
 *     Needed wherever the dialog's own content carries state that must
 *     survive a close — the feedback form remembers a just-sent message until
 *     it is reopened.
 *
 * `portal`, on by default: renders through `createPortal` into `document.body`.
 * Load-bearing wherever the dialog might sit inside a `<form>` — nearly every
 * signed-in page under (app) is itself one big form, and a `<form>` nested in
 * a `<form>` is invalid HTML the parser silently drops, taking the nested
 * one's submit handler with it (see the destination picker's own note on
 * this in LocationSelect.tsx). Turn it off only where the caller is certain
 * the dialog can never end up under a form — the nav drawer and the card
 * sheet both render from the signed-in layout, above any page content.
 *
 * A portal needs `document`, which does not exist while this renders on the
 * server — see `useCanPortal` below for how that stays out of the render
 * body itself, which is what a `keepMounted` + `portal` dialog needs to
 * hydrate cleanly.
 */
/**
 * Whether it is safe to call `createPortal` yet.
 *
 * The bug this replaced checked `typeof document === "undefined"` directly
 * in the render body. That reads as an environment check, but it is really a
 * *when* check in disguise: the server render sees no `document`, and the
 * client's very first render — the one React diffs against the server's HTML
 * to hydrate — already has one, because a browser always does. So on the two
 * renders React requires to agree, this disagreed every single time, and
 * for `keepMounted` + `portal` (only `FeedbackButton` today) that showed up
 * as a full hydration failure rather than a quiet no-op, because the
 * portalled node is either there or it is not — there is no smaller unit to
 * mismatch on.
 *
 * `useSyncExternalStore`'s third argument, `getServerSnapshot`, is what fixes
 * this: React calls it — not `getSnapshot` — for the server render *and* for
 * the client's first, hydration-matching render, so both agree "not yet."
 * Only the render after that, an ordinary post-mount update rather than a
 * hydration pass, is allowed to see the real answer. `useMediaQuery` in
 * CardPanel.tsx and `useCardPreviewMode` in CardPreviewMode.tsx lean on the
 * same contract for the same reason: something only the browser knows,
 * reconciled after mount instead of raced against it.
 */
function useCanPortal(): boolean {
  return useSyncExternalStore(
    () => () => {}, // Settled once, at mount — nothing external to subscribe to.
    () => true,
    () => false, // Used for the server render and the client's hydration render alike.
  );
}

export function Dialog({
  open,
  onClose,
  children,
  className,
  label,
  labelledBy,
  portal = true,
  keepMounted = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Accessible name. Use this or `labelledBy`, not both. */
  label?: string;
  /** Points at a heading already in `children`, for a dialog with a visible title. */
  labelledBy?: string;
  portal?: boolean;
  keepMounted?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const canPortal = useCanPortal();

  // Only meaningful when the element stays mounted across opens: syncs its
  // native open state with `open` the way the nav drawer and feedback form
  // always have. Sets no React state of its own — this is the case effects
  // exist for, reconciling a DOM API that keeps state React does not know
  // about.
  useEffect(() => {
    if (!keepMounted) return;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open, keepMounted]);

  // The mount-only path: the element does not exist until `open` is true, so
  // there is no later moment for an effect to catch it in — `showModal()` has
  // to run the instant the node is created.
  const mount = (el: HTMLDialogElement | null) => {
    if (el && !el.open) el.showModal();
    ref.current = el;
  };

  if (!keepMounted && !open) return null;

  const node = (
    <dialog
      ref={keepMounted ? ref : mount}
      onClose={onClose}
      // A click whose target is the dialog itself landed on the backdrop;
      // clicks on the content hit a descendant instead.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cx("bg-surface p-0 text-ink backdrop:bg-scrim", className)}
    >
      {children}
    </dialog>
  );

  if (!portal) return node;
  // Not yet safe to reach `document.body` — see useCanPortal. This renders
  // identically on the server and on the client's first, hydration-matching
  // pass; the swap to the real portal happens on the ordinary render after.
  if (!canPortal) return null;
  return createPortal(node, document.body);
}
