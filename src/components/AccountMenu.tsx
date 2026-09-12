"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/auth/actions";
import { setCardPreviewMode, useCardPreviewMode } from "@/components/CardPreviewMode";
import { toggleDarkTheme, useIsDarkTheme } from "@/components/ThemeToggle";
import { cx } from "@/components/ui";

/**
 * The account control in the header.
 *
 * Was a "Sign out" button sitting next to a separate username link. Now the
 * username *is* the button, and it drops down the two things you would want it
 * for: your settings, and the way out. One target instead of two, and the
 * destructive one is a click deeper rather than always on show.
 *
 * The card-sidebar and theme rows joined it later: below `lg` this menu does
 * not exist at all (the drawer takes over), so it is the only place a mouse
 * user reaches those two settings without a trip to Settings' Appearance
 * section. Both go through the same read/write helpers the header's own
 * toggles use — see CardPreviewMode.tsx and ThemeToggle.tsx — rather than
 * keeping a second copy of that state here.
 */
export function AccountMenu({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const sidebarOn = useCardPreviewMode() === "sidebar";
  const darkOn = useIsDarkTheme();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative hidden lg:block">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "flex max-w-40 items-center gap-1 rounded-md px-2.5 py-1.5 text-sm transition-colors",
          open
            ? "bg-surface-muted text-ink"
            : "text-ink-muted hover:bg-surface-muted hover:text-ink",
        )}
      >
        <span className="truncate">{label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        >
          {/* xl-only for the reason CardPreviewMode's own header gives: below
              that width there is no docked sidebar to switch off, touch gets
              a sheet regardless, and the choice would do nothing. */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={sidebarOn}
            onClick={() => setCardPreviewMode(sidebarOn ? "tooltip" : "sidebar")}
            className="hidden w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted coarse:min-h-11 xl:flex"
          >
            Card sidebar
            <StateBox checked={sidebarOn} />
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={darkOn}
            onClick={toggleDarkTheme}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted coarse:min-h-11"
          >
            Dark theme
            <StateBox checked={darkOn} />
          </button>

          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
          >
            Settings
          </Link>
          <form action={signOut} className="border-t border-border">
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-surface-muted"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/** The visible half of a `menuitemcheckbox` row: `aria-checked` carries the
 *  state for a screen reader, this carries it for an eye — a square that
 *  fills in rather than a label that disappears, so "off" still reads as a
 *  deliberate state rather than a rendering gap. */
function StateBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex size-4 shrink-0 items-center justify-center rounded border",
        checked ? "border-accent bg-accent text-accent-ink" : "border-border text-transparent",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3"
      >
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
      </svg>
    </span>
  );
}
