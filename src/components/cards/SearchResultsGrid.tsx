"use client";

import Image from "next/image";
import { useRef, useState, useSyncExternalStore } from "react";

import { useCardPanel } from "@/components/CardPanel";
import { cx } from "@/components/ui";
import type { CardSearchResult } from "@/lib/cards/search";

type TileSize = "s" | "m" | "l";

const TILE_SIZES: Record<TileSize, { minmax: string; imageWidth: string; label: string }> = {
  s: { minmax: "9rem", imageWidth: "12rem", label: "Small" },
  m: { minmax: "12rem", imageWidth: "16rem", label: "Medium" },
  l: { minmax: "16rem", imageWidth: "20rem", label: "Large" },
};

/**
 * Where the size choice lives — an external store, the same reasoning
 * `PriceToggle` uses: it's in localStorage, the server can't read it, and
 * reading it in an effect just to call `setState` is the pattern React now
 * flags. Only this one component reads it today, but the store still needs
 * to report an SSR-safe snapshot, so it gets the same shape regardless.
 */
const STORAGE_KEY = "upkeep.search.tileSize";
const listeners = new Set<() => void>();
let unsaved: TileSize | null = null;

function isTileSize(value: string | null): value is TileSize {
  return value === "s" || value === "m" || value === "l";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSize(): TileSize {
  try {
    const stored = unsaved ?? localStorage.getItem(STORAGE_KEY);
    return isTileSize(stored) ? stored : "l";
  } catch {
    return unsaved ?? "l";
  }
}

/** Large on the server, so the markup React hydrates matches. */
const readSizeOnServer = (): TileSize => "l";

function writeSize(size: TileSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, size);
    unsaved = null;
  } catch {
    unsaved = size;
  }
  for (const listener of listeners) listener();
}

/**
 * Results for `/search`, one printing's thumbnail per card name — the same
 * grouping the header dropdown's card lookup already does. A click opens the
 * card popup (`useCardPanel`'s sheet presentation), the same "look at it,
 * maybe add it" path the dropdown and `/find` use, so a card reached from
 * here is never a dead end.
 *
 * No name or print count under the tile: the card's own name is printed on
 * the card, and this page is a visual browse, not a list — a caption under
 * every tile is the thing that made the grid read as small thumbnails
 * instead of cards you could actually read. Tiles size themselves with
 * `auto-fill`/`minmax` rather than a fixed column count per breakpoint, so
 * "big enough to read" holds at any window width instead of being tuned for
 * one — the size picker just changes what that minmax floor is.
 *
 * Defaults to Large and remembers the choice in localStorage — a viewing
 * preference, not page state worth putting in the URL.
 */
export function SearchResultsGrid({ results }: { results: CardSearchResult[] }) {
  const { open } = useCardPanel();
  const size = useSyncExternalStore(subscribe, readSize, readSizeOnServer);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SizePicker size={size} onChange={writeSize} />
      </div>

      <ul
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_SIZES[size].minmax}, 1fr))` }}
      >
        {results.map((card) => (
          <li key={card.name}>
            <MagnifierTile
              image={card.sample_image_uri_large ?? card.sample_image_uri}
              label={card.sample_flavor_name ?? card.name}
              imageWidth={TILE_SIZES[size].imageWidth}
              onClick={() => card.sample_card_id && open(card.sample_card_id)}
              disabled={!card.sample_card_id}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SizePicker({ size, onChange }: { size: TileSize; onChange: (size: TileSize) => void }) {
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
    s: [
      { x: 1, y: 1, s: 4 },
      { x: 6, y: 1, s: 4 },
      { x: 11, y: 1, s: 4 },
      { x: 1, y: 6, s: 4 },
      { x: 6, y: 6, s: 4 },
      { x: 11, y: 6, s: 4 },
      { x: 1, y: 11, s: 4 },
      { x: 6, y: 11, s: 4 },
      { x: 11, y: 11, s: 4 },
    ],
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

const LENS_SIZE = 130;
// How much closer the loupe brings you than the tile's own on-screen size.
const ZOOM = 2.4;

/**
 * A card tile whose hover state is a literal loupe — the cursor itself
 * hides, and a circular lens follows it showing a magnified crop of exactly
 * the art under the pointer, not a static icon or a zoom on the whole tile.
 *
 * Plain mouse tracking (position state updated in onMouseMove), scoped to
 * this one tile so hovering one card never re-renders the rest of the grid.
 * The lens is a `background-image` at a larger `background-size`, offset by
 * the pointer's position scaled by the same zoom factor — the standard
 * "product photo" loupe technique, done in CSS rather than drawing to a
 * canvas, so it costs nothing beyond the position update itself.
 */
function MagnifierTile({
  image,
  label,
  imageWidth,
  onClick,
  disabled,
}: {
  image: string | null;
  label: string;
  /** The tile's own current-size floor (`TILE_SIZES[size].imageWidth`), so
   *  Next only downloads an image as large as what's actually on screen. */
  imageWidth: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [lens, setLens] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  function onMouseMove(event: React.MouseEvent<HTMLButtonElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setLens({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      w: box.width,
      h: box.height,
    });
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setLens(null)}
      disabled={disabled}
      aria-label={label}
      className="relative block aspect-[488/680] w-full cursor-none overflow-hidden rounded-lg border border-border bg-surface-muted"
    >
      {image ? (
        <Image
          src={image}
          alt=""
          fill
          sizes={`(min-width: 1024px) ${imageWidth}, (min-width: 640px) 40vw, 50vw`}
          className="object-cover"
          unoptimized
        />
      ) : null}

      {lens && image ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full border-4 border-white shadow-[0_2px_12px_rgba(0,0,0,0.45)]"
          style={{
            left: lens.x - LENS_SIZE / 2,
            top: lens.y - LENS_SIZE / 2,
            width: LENS_SIZE,
            height: LENS_SIZE,
            backgroundImage: `url(${image})`,
            backgroundSize: `${lens.w * ZOOM}px ${lens.h * ZOOM}px`,
            backgroundPosition: `${-(lens.x * ZOOM - LENS_SIZE / 2)}px ${-(lens.y * ZOOM - LENS_SIZE / 2)}px`,
            backgroundRepeat: "no-repeat",
          }}
        >
          {/* The handle — what makes a circle read as a magnifying glass
              rather than a plain loupe ring. */}
          <span
            aria-hidden="true"
            className="absolute -bottom-2 -right-2 h-2.5 w-6 rounded-full border border-white/70 bg-ink shadow"
            style={{ transform: "rotate(45deg)" }}
          />
        </span>
      ) : null}
    </button>
  );
}
