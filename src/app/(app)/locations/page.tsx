import Link from "next/link";

import { getLocationTree, UNSORTED } from "@/lib/collection/queries";
import { LocationManager } from "@/components/LocationManager";
import { Card as Panel, EmptyState } from "@/components/ui";

export const metadata = { title: "Locations · MTGManager" };

export default async function LocationsPage() {
  const { tree, unsortedCount } = await getLocationTree();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Locations</h1>
        <p className="text-sm text-[--color-ink-muted]">
          Where your cards physically live. Deleting a location never deletes cards —
          they become unsorted, and anything nested inside moves up a level.
        </p>
      </div>

      {/* Unsorted is a first-class place, not an error state, so it gets a real
          row rather than being hidden behind a filter. */}
      <Panel className="flex items-center justify-between">
        <div>
          <Link href={`/collection?location=${UNSORTED}`} className="font-medium hover:underline">
            Unsorted
          </Link>
          <p className="text-xs text-[--color-ink-muted]">
            Cards you own but haven&apos;t filed anywhere yet.
          </p>
        </div>
        <span className="text-sm text-[--color-ink-muted]">
          {unsortedCount} card{unsortedCount === 1 ? "" : "s"}
        </span>
      </Panel>

      <LocationManager tree={tree} topLevel={tree} />

      {tree.length === 0 ? (
        <EmptyState title="No locations yet.">
          Create a binder, box or deck above, then assign cards to it from your
          collection.
        </EmptyState>
      ) : null}
    </div>
  );
}
