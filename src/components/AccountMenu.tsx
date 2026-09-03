"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/auth/actions";
import { cx } from "@/components/ui";

/**
 * The account control in the header.
 *
 * Was a "Sign out" button sitting next to a separate username link. Now the
 * username *is* the button, and it drops down the two things you would want it
 * for: your settings, and the way out. One target instead of two, and the
 * destructive one is a click deeper rather than always on show.
 */
export function AccountMenu({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

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
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
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
