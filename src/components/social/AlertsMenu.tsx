"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";
import {
  notificationHref,
  notificationSentence,
  relativeTime,
} from "@/lib/social/notifications";
import type { NotificationDetail } from "@/lib/social/types";
import { cx } from "@/components/ui";

/**
 * The alerts button, and what is waiting behind it.
 *
 * Clicking used to navigate to the alerts page. For the common case — "is there
 * anything?" — that is a page load to answer a question a short list could
 * answer in place, so the button opens a dropdown of the most recent alerts and
 * the page becomes where you go for the whole history.
 *
 * Opening does not mark anything read. A glance is not an acknowledgement, and
 * a badge that cleared itself because you looked at it would lose the one
 * thing it is for. "Mark all read" is explicit; the page still clears on view,
 * because opening it in full is a deliberate act.
 */
export function AlertsMenu({ unread }: { unread: number }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [marking, startMarking] = useTransition();

  // Close on an outside click or Escape, and hand focus back to the button.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Load on open, and again on each open so a list left sitting is never stale.
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/notifications", { signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { notifications: NotificationDetail[] };
        setItems(body.notifications);
      } catch {
        // Aborted or offline. The footer link still reaches the full page.
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [open]);

  function markRead() {
    startMarking(async () => {
      await markAllNotificationsRead();
      setItems((current) =>
        current?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null,
      );
      router.refresh();
    });
  }

  return (
    <div ref={container} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        className={cx(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
          open
            ? "bg-surface-muted text-ink"
            : "text-ink-muted hover:bg-surface-muted hover:text-ink",
        )}
      >
        Alerts
        {unread > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold tabular-nums text-accent-ink">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-semibold">Alerts</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markRead}
                disabled={marking}
                className="text-xs text-accent hover:underline disabled:opacity-50"
              >
                {marking ? "Marking…" : "Mark all read"}
              </button>
            ) : null}
          </div>

          {items === null && loading ? (
            <p className="px-3 py-4 text-sm text-ink-muted">Loading…</p>
          ) : !items || items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-muted">
              Nothing pending. Offers and their replies show up here.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={notificationHref(item.type)}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.read_at === null ? "bg-accent" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        {notificationSentence(item.type, item.actor?.username ?? "Someone")}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {relativeTime(item.created_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-xs text-accent hover:bg-surface-muted"
          >
            See all alerts
          </Link>
        </div>
      ) : null}
    </div>
  );
}
