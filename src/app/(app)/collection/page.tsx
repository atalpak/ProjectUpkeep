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

  // The export route takes the same filter parameters, so "export what I am
  // looking at" stays true.
  const exportParams = filterToParams(filter);
  if (filtered) exportParams.set("filtered", "1");
  const exportHref = `/api/collection/export?${exportParams.toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Collection"
        subtitle={
          <>
            {totalCards} card{totalCards === 1 ? "" : "s"} in {collection.matched} entr
            {collection.matched === 1 ? "y" : "ies"}
            {filtered ? ` (filtered from ${collection.total})` : ""}
          </>
        }
        actions={
          <>
            {collection.matched > 0 ? (
              <ExportButtons
                // Generated on click rather than inlined here: the page is
                // paginated, so it no longer holds every row to serialise.
                source={{ kind: "remote", href: exportHref }}
                filenameBase={filtered ? "collection-filtered" : "collection"}
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
          {collection.matched} matching entries were searched. Narrowing by set, location or
          condition first will cover the whole collection.
        </p>
      ) : null}

      {collection.rows.length === 0 ? (
        filtered ? (
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
