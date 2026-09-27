"use client";

import Image from "next/image";
import { useRef, useState, useSyncExternalStore } from "react";
import { isTileSize, type TileSize } from "@/components/cards/TileSizePicker";

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
    // "s" was Small, removed along with the option itself — read as Medium
    // rather than falling all the way back to the Large default.
    if (stored === "s") return "m";
    return isTileSize(stored) ? stored : "l";
  } catch {
    return unsaved ?? "l";
  }
}

/** Large on the server, so the markup React hydrates matches. */
const readSizeOnServer = (): TileSize => "l";

export function useTileSize(): [TileSize, (size: TileSize) => void] {
  return [useSyncExternalStore(subscribe, readSize, readSizeOnServer), writeSize];
}

function writeSize(size: TileSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, size);
    unsaved = null;
  } catch {
    unsaved = size;
  }
  for (const listener of listeners) listener();
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
export function MagnifierTile({
  image,
  label,
  imageWidth,
  onClick,
  onImageError,
  disabled,
}: {
  image: string | null;
  label: string;
  /** The tile's own current-size floor (`TILE_SIZES[size].imageWidth`), so
   *  Next only downloads an image as large as what's actually on screen. */
  imageWidth: string;
  onClick: () => void;
  /** Called when the picture fails to load; a flipped tile falls back to its front. */
  onImageError?: () => void;
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
          onError={onImageError}
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
