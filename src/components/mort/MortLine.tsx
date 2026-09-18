import type { ReactNode } from "react";

/**
 * Mort's own voice, rendered beside the product's own copy — never replacing
 * it (brand doc §11/§12: "do not convert every system message into Mort
 * dialogue"). Server-safe: plain text, no interactivity, so nothing here
 * needs a client boundary.
 */
export function MortLine({ children }: { children: ReactNode }) {
  return <p className="font-brand italic text-ink-muted">{children}</p>;
}
