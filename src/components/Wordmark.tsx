import Image from "next/image";

import { cx } from "@/components/ui";

/**
 * Custom horizontal lettering: modern PROJECT beside calligraphic Upkeep.
 * Theme variants follow the root `.dark` class before first paint.
 */
const WORDMARK_RATIO = 1600 / 484;

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
  const height = size === "lg" ? 44 : 34;
  const width = Math.round(height * WORDMARK_RATIO);

  return (
    <span className={cx("inline-flex items-center", className)}>
      <Image
        src="/brand/wordmark-light.png"
        alt="Project Upkeep"
        width={width}
        height={height}
        loading="eager"
        className="block dark:hidden"
        style={{ height, width: "auto" }}
      />
      <Image
        src="/brand/wordmark-dark.png"
        alt="Project Upkeep"
        width={width}
        height={height}
        loading="eager"
        className="hidden dark:block"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
