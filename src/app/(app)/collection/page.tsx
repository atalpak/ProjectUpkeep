import Link from "next/link";

import {
  getAvailability,
  getCollection,
  getCollectionSets,
  getLocations,
} from "@/lib/collection/queries";
import { filterFromParams, isFilterActive } from "@/lib/collection/filters";
import { stacksToDecklistText, toCsv, type ExportRow } from "@/lib/collection/export";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { CollectionTable } from "@/components/collection/CollectionTable";
import { ExportButtons } from "@/components/ExportButtons";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import type { CardInstanceWithCard } from "@/lib/types";

/** One stack, as `getCollection` returns it, ready for src/lib/collection/export.ts. */
function toExportRow(row: CardInstanceWithCard): ExportRow {
  return {
    card: row.cards
      ? { name: row.cards.name, setCode: row.cards.set_code, collectorNumber: row.cards.collector_number }
      : null,
    quantity: row.quantity,
    finish: row.finish,
    condition: row.condition,
    language: row.language,
    locationName: row.locations?.name ?? null,
  };
}

export const metadata = { title: "Collection · Project Upkeep" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filter = filterFromParams(await searchParams);

  const [collection, locations, sets, availability] = await Promise.all([
    getCollection(filter),
    getLocations(),
    getCollectionSets(),
    getAvailability(),
  ]);

  // Physical cards, not rows — a stack of 12 should read as 12.
  const totalCards = collection.rows.reduce((sum, i) => sum + i.quantity, 0);
  const filtered = isFilterActive(filter);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Collection"
        subtitle={
          <>
            {totalCards} card{totalCards === 1 ? "" : "s"} in {collection.rows.length} entr
            {collection.rows.length === 1 ? "y" : "ies"}
            {filtered ? ` (filtered from ${collection.total})` : ""}
          </>
        }
        actions={
          <>
            {collection.rows.length > 0 ? (
              <ExportButtons
                decklistText={stacksToDecklistText(collection.rows.map(toExportRow))}
                csv={toCsv(collection.rows.map(toExportRow), { includeLocation: true })}
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
          Showing the first {collection.total} entries. Filtering beyond that needs the query to
          move into the database — see the note in src/lib/collection/filters.ts.
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
        />
      )}
    </div>
  );
}
