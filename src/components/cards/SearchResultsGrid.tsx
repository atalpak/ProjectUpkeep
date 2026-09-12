"use client";

import Image from "next/image";

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
          <button
            type="button"
            onClick={() => card.sample_card_id && open(card.sample_card_id)}
            disabled={!card.sample_card_id}
            aria-label={card.sample_flavor_name ?? card.name}
            className="group relative block aspect-[488/680] w-full overflow-hidden rounded-lg border border-border bg-surface-muted"
          >
            {card.sample_image_uri_large ?? card.sample_image_uri ? (
              <Image
                src={(card.sample_image_uri_large ?? card.sample_image_uri) as string}
                alt=""
                fill
                sizes="(min-width: 1024px) 16rem, (min-width: 640px) 33vw, 45vw"
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                unoptimized
              />
            ) : null}

            {/* The "look closer" affordance: a magnifying glass that pops in
                on hover rather than sitting there always, and a matching dark
                wash so it reads against art of any brightness. Pure CSS
                (opacity/scale transitions, no JS), so it costs nothing to
                animate. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/25 group-hover:opacity-100"
            >
              <MagnifyingGlassIcon className="size-10 scale-75 text-white drop-shadow transition-transform duration-200 ease-out group-hover:scale-100" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MagnifyingGlassIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.35-4.35" />
    </svg>
  );
}
