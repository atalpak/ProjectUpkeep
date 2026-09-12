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
 */
export function SearchResultsGrid({ results }: { results: CardSearchResult[] }) {
  const { open } = useCardPanel();

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {results.map((card) => (
        <li key={card.name}>
          <button
            type="button"
            onClick={() => card.sample_card_id && open(card.sample_card_id)}
            disabled={!card.sample_card_id}
            className="block w-full text-left"
          >
            <span className="relative block aspect-[488/680] overflow-hidden rounded-lg border border-border bg-surface-muted">
              {card.sample_image_uri ? (
                <Image
                  src={card.sample_image_uri}
                  alt=""
                  fill
                  sizes="10rem"
                  className="object-cover"
                  unoptimized
                />
              ) : null}
            </span>
            <span className="mt-1 block truncate text-xs font-medium">
              {card.sample_flavor_name ?? card.name}
            </span>
            <span className="block text-[11px] text-ink-muted">
              {card.printing_count} print{card.printing_count === 1 ? "" : "s"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
