import Link from "next/link";

import { getCollection, getLocations, UNSORTED } from "@/lib/collection/queries";
import { CollectionList } from "@/components/CollectionList";
import { Button, EmptyState, Input, Select } from "@/components/ui";

export const metadata = { title: "Collection · MTGManager" };

type SearchParams = Promise<{ location?: string; q?: string }>;

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { location, q } = await searchParams;

  const [instances, locations] = await Promise.all([
    getCollection({ location, q }),
    getLocations(),
  ]);

  // Physical cards, not rows — a stack of 12 should read as 12.
  const totalCards = instances.reduce((sum, i) => sum + i.quantity, 0);
  const filtered = Boolean(location || q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Collection</h1>
          <p className="text-sm text-[--color-ink-muted]">
            {totalCards} card{totalCards === 1 ? "" : "s"} in {instances.length} entr
            {instances.length === 1 ? "y" : "ies"}
            {filtered ? " (filtered)" : ""}
          </p>
        </div>

        <Link href="/collection/add">
          <Button>Add a card</Button>
        </Link>
      </div>

      {/* A plain GET form: filters end up in the URL, so they survive a refresh
          and can be linked to. */}
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex-1 min-w-48 space-y-1">
          <span className="text-xs font-medium text-[--color-ink-muted]">Search</span>
          <Input name="q" defaultValue={q ?? ""} placeholder="Card name" />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-[--color-ink-muted]">Location</span>
          <Select name="location" defaultValue={location ?? ""} className="w-52">
            <option value="">Everywhere</option>
            <option value={UNSORTED}>Unsorted</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>

        <Button variant="secondary" type="submit">
          Apply
        </Button>
        {filtered ? (
          <Link href="/collection" className="text-sm text-[--color-accent] underline">
            Clear
          </Link>
        ) : null}
      </form>

      {instances.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches those filters.">
            <Link href="/collection" className="text-[--color-accent] underline">
              Clear the filters
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title="Your collection is empty.">
            <p>
              <Link href="/collection/add" className="text-[--color-accent] underline">
                Add your first card
              </Link>{" "}
              to get started.
            </p>
            <p className="mt-2 text-xs">
              Nothing to search? The card database is populated by the Scryfall sync —
              run <code>npm run sync:scryfall</code>.
            </p>
          </EmptyState>
        )
      ) : (
        <CollectionList instances={instances} locations={locations} />
      )}
    </div>
  );
}
