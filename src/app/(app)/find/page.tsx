import Image from "next/image";
import Link from "next/link";

import { locateInCollection, UNSORTED } from "@/lib/collection/queries";
import { MIN_TERM, type LocatedCard, type Place } from "@/lib/collection/locate";
import { matchFriendTradablesByTerm } from "@/lib/social/queries";
import type { FriendCardMatch } from "@/lib/social/wants";
import type { Profile } from "@/lib/social/types";
import { LOCATION_TYPE_LABELS } from "@/lib/types";
import { CardLocator } from "@/components/collection/CardLocator";
import { CardPreviewLink } from "@/components/CardPanel";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Find a card · Project Upkeep" };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * "Where is my card?" — and, in the same breath, among the people I know.
 *
 * The payoff of tracking where cards live: type a name, and see which binder,
 * box or deck every copy is in — with a link straight to that shelf of the
 * collection. The "Among your friends" section below is the other half of
 * the app's actual premise: the same search, run against every friend's
 * trade binder rather than your own. It shows nothing a visit to a friend's
 * profile would not — a card only appears there because they marked its
 * container tradable (migration 9's policy), exactly the same visibility
 * `/u/[username]` gives a human reader.
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const query = one((await searchParams).q);
  const active = query.trim().length >= MIN_TERM;

  const [results, friendSearch] = active
    ? await Promise.all([locateInCollection(query), matchFriendTradablesByTerm(query)])
    : [[] as LocatedCard[], { matches: [] as FriendCardMatch[], suppliers: new Map<string, Profile>() }];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Find a card"
        subtitle="Search your collection and see exactly where every copy lives."
      />

      <CardLocator initialQuery={query} />

      {!active ? (
        <p className="text-sm text-ink-muted">
          Type at least {MIN_TERM} letters of a card name.
        </p>
      ) : (
        <>
          {results.length === 0 ? (
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

          {friendSearch.matches.length > 0 ? (
            <FriendMatches matches={friendSearch.matches} suppliers={friendSearch.suppliers} />
          ) : null}
        </>
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
              {card.displayName}
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

/**
 * "Among your friends" — the cross-person answer, grouped the same way the
 * own-collection results above are: one row per card, every supplier under it.
 */
function FriendMatches({
  matches,
  suppliers,
}: {
  matches: FriendCardMatch[];
  suppliers: Map<string, Profile>;
}) {
  return (
    <div className="space-y-2 pt-2">
      <h2 className="text-sm font-medium text-ink-muted">Among your friends</h2>
      <ul className="space-y-2">
        {matches.map((match) => (
          <FriendMatchRow key={match.key} match={match} suppliers={suppliers} />
        ))}
      </ul>
    </div>
  );
}

function FriendMatchRow({
  match,
  suppliers,
}: {
  match: FriendCardMatch;
  suppliers: Map<string, Profile>;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="font-medium">{match.displayName}</div>
      <ul className="mt-1.5 space-y-1">
        {match.suppliers.map((s) => {
          const username = suppliers.get(s.ownerId)?.username ?? "a friend";
          return (
            <li key={s.ownerId} className="flex items-center gap-2 text-sm">
              <span className="w-8 shrink-0 text-right tabular-nums text-ink-muted">
                ×{s.available}
              </span>
              <Link
                href={`/u/${encodeURIComponent(username)}`}
                className="text-accent hover:underline"
              >
                {username}
              </Link>
              {s.locations.length > 0 ? (
                <span className="truncate text-ink-muted">, {s.locations.join(", ")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
