"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { useCardPanel } from "@/components/CardPanel";
import type { CardSearchResult } from "@/lib/cards/search";

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
 * one.
 */
export function SearchResultsGrid({ results }: { results: CardSearchResult[] }) {
  const { open } = useCardPanel();

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
      {results.map((card) => (
        <li key={card.name}>
          <MagnifierTile
            image={card.sample_image_uri_large ?? card.sample_image_uri}
            label={card.sample_flavor_name ?? card.name}
            onClick={() => card.sample_card_id && open(card.sample_card_id)}
            disabled={!card.sample_card_id}
          />
        </li>
      ))}
    </ul>
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
  onClick,
  disabled,
}: {
  image: string | null;
  label: string;
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
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 16rem, (min-width: 640px) 33vw, 45vw" className="object-cover" unoptimized />
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
