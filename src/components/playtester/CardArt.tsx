"use client";

import Image from "next/image";
import { memo, useState } from "react";

import { cx } from "@/lib/cx";

/**
 * A card-shaped picture that never makes the board jump.
 *
 * The box is always a 5:7 rectangle, and the name is painted behind the image
 * as a placeholder, so the table has its final shape before any art arrives
 * (a slow Scryfall image, or none at all for a custom token). The image fills
 * the box; the box never resizes to the image.
 *
 * `unoptimized`: cards are already right-sized JPEGs on Scryfall's CDN, and
 * routing them through Next's optimizer would need a remote-pattern allowance
 * and a paid transform for no gain. The table passes the SMALL art; the normal
 * art is only ever requested by the inspector.
 *
 * `faceDown` paints the sleeve instead, in the player's chosen sleeve colour
 * (`--sleeve` on the table root). The alt text says what a screen reader
 * should hear, which for a face-down card is deliberately not its name.
 */
/** The standard Magic card back, as Scryfall serves it. */
export const CARD_BACK_URL = "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

export const CardArt = memo(function CardArt({
  src,
  alt,
  label,
  faceDown = false,
  priority = false,
  className,
}: {
  src: string | null;
  alt: string;
  /** Painted behind the image while it loads, and when there is none. */
  label: string;
  faceDown?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [backFailed, setBackFailed] = useState(false);
  const broken = failed === src;

  if (faceDown) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cx("relative aspect-[5/7] w-full overflow-hidden rounded-[5%] border border-black/40 shadow-[var(--shadow-card)]", className)}
        style={{ background: "repeating-linear-gradient(45deg, var(--sleeve, #c9a34a) 0 6px, color-mix(in srgb, var(--sleeve, #c9a34a) 70%, black) 6px 12px)" }}
      >
        {/* The back of a Magic card, from Scryfall's CDN like every other card
            picture here. The sleeve pattern underneath is the fallback when it
            cannot load (offline), and still honours the sleeve colour setting. */}
        {!backFailed ? <Image src={CARD_BACK_URL} alt="" fill sizes="200px" unoptimized draggable={false} className="object-cover" onError={() => setBackFailed(true)} /> : <span className="absolute inset-[7%] rounded-[6%] border border-white/25" aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div className={cx("relative aspect-[5/7] w-full overflow-hidden rounded-[5%] bg-surface-muted shadow-[var(--shadow-card)]", className)}>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center p-[8%] text-center text-[clamp(8px,1.1cqw,12px)] font-medium leading-tight text-ink-muted"
      >
        {label}
      </span>
      {src && !broken ? (
        <Image src={src} alt={alt} fill sizes="200px" unoptimized priority={priority} draggable={false} className="object-cover" onError={() => setFailed(src)} />
      ) : (
        <span className="sr-only">{alt}</span>
      )}
    </div>
  );
});
