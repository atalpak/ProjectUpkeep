import Image from "next/image";
import Link from "next/link";

import { locateInCollection, UNSORTED } from "@/lib/collection/queries";
import { MIN_TERM, type LocatedCard, type Place } from "@/lib/collection/locate";
import { LOCATION_TYPE_LABELS } from "@/lib/types";
import { CardLocator } from "@/components/collection/CardLocator";
import { CardPreviewLink } from "@/components/CardPanel";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Find a card · Project Upkeep" };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * "Where is my card?"
 *
 * The payoff of tracking where cards live: type a name, and see which binder,
 * box or deck every copy is in — with a link straight to that shelf of the
 * collection.
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const query = one((await searchParams).q);
  const active = query.trim().length >= MIN_TERM;
  const results = active ? await locateInCollection(query) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Find a card"
        subtitle="Search your collection and see exactly where every copy lives."
      />

      <CardLocator initialQuery={query} />

      {!active ? (
        <p className="text-sm text-ink-muted">
          Type at least {MIN_TERM} letters of a card name.
        </p>
      ) : results.length === 0 ? (
        <EmptyState title={`Nothing in your collection matches “${query.trim()}”.`}>
          <p>
            You may own it under a different name, or not yet —{" "}
            <Link href="/collection/add" className="text-accent underline">
              add a card
            </Link>
            .
          </p>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {results.map((card) => (
            <LocatedRow key={card.key} card={card} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LocatedRow({ card }: { card: LocatedCard }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex gap-3">
        <CardPreviewLink
          card={card.cardId ?? undefined}
          href={`/collection?q=${encodeURIComponent(card.name)}`}
          className="relative block aspect-[488/680] w-14 shrink-0 overflow-hidden rounded border border-border bg-surface-muted"
        >
          {card.image ? (
            <Image
              src={card.image}
              alt=""
              fill
              sizes="3.5rem"
              className="object-cover"
              unoptimized
            />
          ) : null}
        </CardPreviewLink>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              href={`/collection?q=${encodeURIComponent(card.name)}`}
              className="font-medium hover:underline"
            >
              {card.name}
            </Link>
            <span className="text-xs text-ink-muted">
              {card.total} cop{card.total === 1 ? "y" : "ies"}
              {card.available < card.total
                ? ` · ${card.available} not in a deck`
                : ""}
            </span>
          </div>

          <ul className="mt-1.5 space-y-1">
            {card.places.map((place) => (
              <PlaceRow key={place.locationId ?? "unsorted"} place={place} name={card.name} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

function PlaceRow({ place, name }: { place: Place; name: string }) {
  const href =
    place.locationId === null
      ? `/collection?location=${UNSORTED}&q=${encodeURIComponent(name)}`
      : `/collection?location=${place.locationId}&q=${encodeURIComponent(name)}`;

  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-8 shrink-0 text-right tabular-nums text-ink-muted">
        ×{place.quantity}
      </span>
      <Link href={href} className="truncate hover:underline">
        {place.name}
      </Link>
      {place.type === "unsorted" ? (
        <Badge>Not filed</Badge>
      ) : (
        <Badge>{LOCATION_TYPE_LABELS[place.type]}</Badge>
      )}
    </li>
  );
}
