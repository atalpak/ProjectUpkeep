"use client";

import Image from "next/image";
import { useState } from "react";

import { cx } from "@/components/ui";

/**
 * A set's symbol, from Scryfall's own set-icon CDN
 * (svgs.scryfall.io/sets/<code>.svg), shown next to the set name or code.
 *
 * Loaded client-side as a plain image, the same way ManaSymbol pulls the mana
 * icons. The art is a solid black shape on transparency, so it needs inverting
 * in dark mode to stay visible; not every code Scryfall knows has an icon
 * (some promo and token "sets" do not), so a failed load just hides the mark
 * rather than leaving a broken-image box.
 *
 * `svgs.scryfall.io` is allow-listed in next.config.ts; `unoptimized` skips the
 * optimiser (which refuses remote SVGs) and emits a bare <img>.
 */
export function SetSymbol({
  code,
  className,
  size = 14,
}: {
  code: string | null | undefined;
  className?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const trimmed = code?.trim().toLowerCase();
  if (!trimmed || failed) return null;

  return (
    <Image
      src={`https://svgs.scryfall.io/sets/${trimmed}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      className={cx("inline-block shrink-0 align-middle dark:invert", className)}
    />
  );
}
