"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/auth/actions";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, cx } from "@/components/ui";

/**
 * The signed-in navigation, at both sizes.
 *
 * One list of destinations, rendered two ways: inline from `lg` up, and behind
 * a drawer below it. Six destinations plus the alerts badge and the account
 * controls do not fit a phone's top bar, and they are tight even on a tablet —
 * hence `lg` rather than `md` for the switch.
 *
 * The drawer is a native <dialog> opened with showModal(), which gives the
 * focus trap, the Escape handler and the return-focus-on-close behaviour that
 * would otherwise have to be hand-rolled and got subtly wrong.
 */

export const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/collection", label: "Collection" },
  { href: "/locations", label: "Locations" },
  { href: "/decks", label: "Decks" },
  { href: "/wants", label: "Wish List" },
  { href: "/friends", label: "Friends" },
] as const;

/** The inline destination row. Hidden below `lg`, where the drawer takes over. */
export function AppNavLinks() {
  return (
    <div className="hidden items-center gap-0.5 lg:flex">
      {NAV_LINKS.map((link) => (
        <NavLink key={link.href} href={link.href}>
          {link.label}
        </NavLink>
      ))}
    </div>
  );
}

/** The hamburger and its drawer. Hidden from `lg` up. */
export function AppNavDrawer({ username }: { username: string | null }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  // Drive the native dialog from state. This is an effect synchronising React
  // with a DOM API that has its own open/closed state — the case effects exist
  // for — and it sets no state of its own.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="size-5"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        onClose={close}
        // A click whose target is the dialog itself landed on the backdrop —
        // clicks on the content hit a descendant instead.
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
        aria-label="Menu"
        className={cx(
          // showModal() centres a dialog; ml-auto pins it to the right edge and
          // h-dvh makes it full height against mobile browser chrome.
          "m-0 ml-auto h-dvh max-h-none w-72 max-w-[85vw] bg-surface p-0 text-ink",
          "backdrop:bg-scrim",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold tracking-tight">
              Project<span className="text-accent">Upkeep</span>
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="size-5"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            <ul>
              {NAV_LINKS.map((link) => {
                const active =
                  pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      // Closing here rather than in a pathname effect: the only
                      // way to navigate from inside the drawer is one of these.
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "block rounded-md px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-surface-muted font-medium text-ink"
                          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="space-y-3 border-t border-border p-4">
            {/* The account link the desktop header puts on the username. */}
            <Link
              href="/settings"
              onClick={close}
              className="block rounded-md px-3 py-2.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              Settings
              {username ? (
                <span className="mt-0.5 block truncate text-xs">{username}</span>
              ) : null}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <form action={signOut} className="flex-1">
                <Button variant="secondary" type="submit" className="w-full">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
