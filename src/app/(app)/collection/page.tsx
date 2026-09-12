import Link from "next/link";
import { cookies } from "next/headers";

import {
  getAvailabilityForCards,
  getCollection,
  getCollectionSets,
  getLocations,
} from "@/lib/collection/queries";
import { filterFromParams, filterToParams, isFilterActive } from "@/lib/collection/filters";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { CollectionTable } from "@/components/collection/CollectionTable";
import { SORT_COOKIE, parseSortValue } from "@/components/collection/columns";
import { ExportButtons } from "@/components/ExportButtons";
import { Button, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Collection · Project Upkeep" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const filter = filterFromParams(params);

  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // The URL wins so a sorted view can be linked; the cookie is where a fresh
  // visit starts. The server needs one or the other before it renders, because
  // the database is doing the sorting now.
  const sort =
    parseSortValue(one("sort")) ?? parseSortValue((await cookies()).get(SORT_COOKIE)?.value);

  const requestedPage = Number.parseInt(one("page") ?? "0", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 0;

  const [collection, locations, sets] = await Promise.all([
    getCollection(filter, { sort, page }),
    getLocations(),
    getCollectionSets(),
  ]);

  // Has to wait for the rows: availability is only fetched for the cards on
  // this page. Collection-wide counts, page-wide set of cards.
  const availability = await getAvailabilityForCards(collection.rows.map((r) => r.cards));

  // Physical cards, not rows — a stack of 12 should read as 12. Counted across
  // everything that matches, not just the page on screen.
  const totalCards = collection.matchedCards;
  const filtered = isFilterActive(filter);

  // Whether anything is being held back, by *any* criterion including the
  // default one. `isFilterActive` deliberately ignores a filter left at its
  // default, which is right for the "Advanced (3)" badge and wrong here: the
  // subtitle would then report 459 entries as if that were the whole
  // collection. A default that hides 240 rows must still say so.
  const hidingSome = collection.matched < collection.total;

  // Where "include cards in my decks" points. Built from the current filter so
  // it keeps whatever else is applied — someone searching for a card they own
  // exactly one of, sleeved, should get their search back with the decks
  // included, not a reset page.
  const withDecksHref = `/collection?${filterToParams({ ...filter, availableOnly: false })}`;

  // The export route takes the same filter parameters, so "export what I am
  // looking at" stays true.
  const exportParams = filterToParams(filter);
  if (hidingSome) exportParams.set("filtered", "1");
  const exportHref = `/api/collection/export?${exportParams.toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Collection"
        subtitle={
          <>
            {/* "Unique", not "stacks": a stack is the physical thing — four
                identical commons rubber-banded together — and it is still the
                app's own word for it internally (see stacking.ts), but the
                display copy standardizes on "unique" everywhere we surface a
                distinct-entry count. A foil and a non-foil of one card are two
                unique stacks here, same as they were two stacks before. */}
            {totalCards} card{totalCards === 1 ? "" : "s"} ({collection.matched} unique)
            {hidingSome ? ` (filtered from ${collection.total})` : ""}
          </>
        }
        actions={
          <>
            {collection.matched > 0 ? (
              <ExportButtons
                // Generated on click rather than inlined here: the page is
                // paginated, so it no longer holds every row to serialise.
                source={{ kind: "remote", href: exportHref }}
                filenameBase={hidingSome ? "collection-filtered" : "collection"}
              />
            ) : null}
            <Link href="/collection/import">
              <Button variant="secondary">Import</Button>
            </Link>
            <Link href="/collection/add">
              <Button>Add a card</Button>
            </Link>
          </>
        }
      />

      <CollectionFilters initial={filter} locations={locations} sets={sets} />

      {collection.truncated ? (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          This filter is one the database cannot answer on its own, so only the first{" "}
          {collection.matched} matching stacks were searched. Narrowing by set, location or
          condition first will cover the whole collection.
        </p>
      ) : null}

      {collection.rows.length === 0 ? (
        collection.total === 0 ? (
          <EmptyState title="Your collection is empty.">
            <p>
              <Link href="/collection/add" className="text-accent underline">
                Add your first card
              </Link>{" "}
              or{" "}
              <Link href="/collection/import" className="text-accent underline">
                import a list
              </Link>{" "}
              to get started.
            </p>
          </EmptyState>
        ) : filter.availableOnly ? (
          // The default hides sleeved copies, so an empty result is far more
          // often "it is all in a deck" than "you do not own it" — and saying
          // "nothing matches" to someone looking at a card they definitely own
          // is how a tool loses trust. Offer the way back before anything else.
          <EmptyState
            title={
              filtered
                ? "Nothing matches, among the cards not in a deck."
                : "Every copy you own is sleeved into a deck."
            }
          >
            <p>
              <Link href={withDecksHref} className="text-accent underline">
                Include cards in your decks
              </Link>
              {filtered ? (
                <>
                  {" · "}
                  <Link href="/collection" className="text-accent underline">
                    Clear the filters
                  </Link>
                </>
              ) : null}
            </p>
          </EmptyState>
        ) : filtered ? (
          <EmptyState title="Nothing matches those filters.">
            <Link href="/collection" className="text-accent underline">
              Clear the filters
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title="Your collection is empty.">
            <p>
              <Link href="/collection/add" className="text-accent underline">
                Add your first card
              </Link>{" "}
              or{" "}
              <Link href="/collection/import" className="text-accent underline">
                import a list
              </Link>{" "}
              to get started.
            </p>
          </EmptyState>
        )
      ) : (
        <CollectionTable
          rows={collection.rows}
          locations={locations}
          availability={availability}
          sort={sort}
          page={collection.page}
          pageCount={collection.pageCount}
          matched={collection.matched}
          allIds={collection.allIds}
        />
      )}
    </div>
  );
}
