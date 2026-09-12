import Image from "next/image";

import { cx } from "@/components/ui";

/**
 * The brand mark, as of the owner's redesign: a single wordmark image rather
 * than an icon-plus-text lockup built from SVG shapes. Shipped as two fixed
 * PNGs (public/logo-light.png, public/logo-dark.png) instead of one themed
 * SVG — the letterforms are custom artwork, not something to redraw as
 * paths — swapped with `dark:hidden` / `hidden dark:block` off the same
 * `.dark` class ThemeScript sets before first paint, so there is no flash
 * between themes the way a client-side check would cause.
 *
 * Both files are the same 1206×294 art at different colours; the aspect
 * ratio below (`WORDMARK_RATIO`) comes straight from that, so `size` only
 * has to say how tall to render it.
 */
const WORDMARK_RATIO = 1206 / 294;

/**
 * `size="lg"` is for the signed-out landing page, where the wordmark carries
 * more weight with no nav around it; every signed-in surface (header,
 * drawer) uses the default.
 */
export function Wordmark({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "lg";
}) {
  const height = size === "lg" ? 44 : 28;
  const width = Math.round(height * WORDMARK_RATIO);

  return (
    <span className={cx("inline-flex items-center", className)}>
      <Image
        src="/logo-light.png"
        alt="Project Upkeep"
        width={width}
        height={height}
        priority
        className="block dark:hidden"
        style={{ height, width: "auto" }}
      />
      <Image
        src="/logo-dark.png"
        alt="Project Upkeep"
        width={width}
        height={height}
        priority
        className="hidden dark:block"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
