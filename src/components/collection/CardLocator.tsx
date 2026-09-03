"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui";

/**
 * The search box for the "find a card" page.
 *
 * Keeps the term in the URL (?q=) so a result is linkable and survives a
 * refresh, the same choice the collection filters make. Debounced and using
 * `replace` rather than `push`, so typing a name does not bury the previous
 * page under a stack of history entries.
 */
export function CardLocator({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const first = useRef(true);

  useEffect(() => {
    // The value starts equal to what the URL already says; do not re-navigate
    // to the same place on mount.
    if (first.current) {
      first.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const q = value.trim();
      router.replace(q ? `/find?q=${encodeURIComponent(q)}` : "/find", { scroll: false });
    }, 200);

    return () => clearTimeout(timer);
  }, [value, router]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Sol Ring"
      autoFocus
      aria-label="Find a card in your collection"
      className="text-base"
    />
  );
}
