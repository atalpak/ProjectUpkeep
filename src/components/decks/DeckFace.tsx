import Image from "next/image";

import { cx } from "@/lib/cx";

/**
 * A commander's face, shown whole rather than cropped to the illustration.
 *
 * Cropping to the art band is prettier on a normal creature and wrong
 * everywhere else — a planeswalker, a saga, a full-art land and a
 * transforming card all put their illustration in a different place, and one
 * fixed crop lands on the type line of about a third of them. A whole card is
 * instantly readable as a Magic card, in every frame ever printed, at any
 * size — which is why this one component serves both the decks list (a row's
 * `thumb`) and a deck's own page (its `hero`), rather than each inventing its
 * own crop.
 */
const SIZES = {
  /** The decks list — one row among many, art as a small identifying mark. */
  thumb: { box: "h-[4.9rem] w-14", srcWidth: 146, srcHeight: 204 },
  /** A deck's own page — the commander as the page's visual anchor. */
  hero: { box: "h-[9.8rem] w-28", srcWidth: 292, srcHeight: 408 },
} as const;

export function DeckFace({
  image,
  size,
}: {
  image: string | null;
  size: keyof typeof SIZES;
}) {
  const { box, srcWidth, srcHeight } = SIZES[size];

  if (!image) {
    return (
      <div
        className={cx(
          box,
          "flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border",
        )}
      >
        <span className="text-lg opacity-40" aria-hidden="true">
          ✦
        </span>
      </div>
    );
  }

  return (
    <Image
      src={image}
      alt=""
      width={srcWidth}
      height={srcHeight}
      unoptimized
      className={cx(box, "shrink-0 rounded-lg object-cover")}
    />
  );
}
