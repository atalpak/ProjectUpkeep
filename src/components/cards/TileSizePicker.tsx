"use client";

import { cx } from "@/components/ui";

/**
 * The tile-size chooser, shared by every card grid that needs one.
 *
 * Started life inside `SearchResultsGrid.tsx` with a third, "Small" option;
 * that option is gone (a 9rem tile read as a thumbnail, not a card you could
 * actually look at), leaving Medium and Large. Pulled out to its own module
 * once the collection page's image view needed the identical control — same
 * two sizes, same icon, same behaviour, so there is exactly one place that
 * draws it.
 *
 * Callers own where the choice is persisted (search and collection remember
 * it under different keys), this module only owns what the sizes mean and how
 * the picker looks.
 */

export type TileSize = "m" | "l";

export const TILE_SIZES: Record<TileSize, { minmax: string; imageWidth: string; label: string }> = {
  m: { minmax: "12rem", imageWidth: "16rem", label: "Medium" },
  l: { minmax: "16rem", imageWidth: "20rem", label: "Large" },
};

export function isTileSize(value: string | null): value is TileSize {
  return value === "m" || value === "l";
}

export function SizePicker({ size, onChange }: { size: TileSize; onChange: (size: TileSize) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(Object.keys(TILE_SIZES) as TileSize[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={size === option}
          title={`${TILE_SIZES[option].label} cards`}
          className={cx(
            "flex items-center justify-center px-2.5 py-1.5 transition-colors",
            size === option ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-surface-muted",
          )}
        >
          <SizeIcon size={option} />
          <span className="sr-only">{TILE_SIZES[option].label}</span>
        </button>
      ))}
    </div>
  );
}

/** A grid of squares, fewer and bigger for each step up — the icon shows
 *  what the button does instead of naming it, the same idea as the
 *  list/gallery toggles elsewhere just drawn as a density picker. */
function SizeIcon({ size }: { size: TileSize }) {
  const specs: Record<TileSize, Array<{ x: number; y: number; s: number }>> = {
    m: [
      { x: 1, y: 1, s: 6.5 },
      { x: 8.5, y: 1, s: 6.5 },
      { x: 1, y: 8.5, s: 6.5 },
      { x: 8.5, y: 8.5, s: 6.5 },
    ],
    l: [{ x: 1, y: 1, s: 14 }],
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
      {specs[size].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.s} height={r.s} rx={1} fill="currentColor" />
      ))}
    </svg>
  );
}
