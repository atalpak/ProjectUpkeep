"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";

/**
 * Nav item that knows whether it is the current section.
 *
 * A client component purely because the active state needs the pathname; the
 * layout around it stays a server component.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Prefix match so /collection/add still lights up "Collection".
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-surface-muted font-medium text-ink"
          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
