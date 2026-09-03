"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/components/ThemeScript";
import { cx } from "@/components/ui";

/**
 * Two-state light/dark switch.
 *
 * The icons swap via the `dark:` variant rather than from React state, so the
 * button renders identically on the server and the client. The one thing React
 * does need to know is which way the switch currently points, purely to keep
 * the accessible label honest — and the source of truth for that is the class
 * on <html>, which ThemeScript set before hydration. Reading it through
 * useSyncExternalStore is how you subscribe to state React does not own.
 */

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const isDarkNow = () => document.documentElement.classList.contains("dark");

// During SSR there is no DOM to read. The value only feeds the label, and the
// first client render corrects it, so assuming light here is harmless.
const isDarkOnServer = () => false;

export function ThemeToggle({ className }: { className?: string }) {
  const isDark = useSyncExternalStore(subscribe, isDarkNow, isDarkOnServer);

  function toggle() {
    const next = !isDarkNow();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* Storage blocked: the theme still applies for this page view. */
    }
  }

  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-9 items-center justify-center rounded-md border border-border",
        "text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink",
        className,
      )}
    >
      {/* Sun: shown in dark mode, because light is what pressing gets you. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        className="hidden size-4 dark:block"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>

      {/* Moon: shown in light mode. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 dark:hidden"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    </button>
  );
}
