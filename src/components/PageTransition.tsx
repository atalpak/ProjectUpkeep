"use client";

import { usePathname } from "next/navigation";

/**
 * A short fade-and-rise on every navigation, so the content area doesn't
 * just snap from one page to the next.
 *
 * Keyed on the pathname: React only replays a CSS animation on mount, not on
 * a re-render, so without the key change a client-side navigation (which
 * keeps this component mounted and only swaps `children`) would play the
 * animation once and never again. Remounting the wrapper on every path is
 * the whole trick — the page underneath (often a Server Component already
 * rendered) is untouched.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page-enter">
      {children}
    </div>
  );
}
