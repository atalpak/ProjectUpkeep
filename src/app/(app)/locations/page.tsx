import { getLocationTree } from "@/lib/collection/queries";
import { LocationManager } from "@/components/LocationManager";
import { Banner, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Locations · Project Upkeep" };

export default async function LocationsPage() {
  const { tree, unsortedCount, peek, counts, stats } = await getLocationTree();

  // Decks are excluded: their contents reach friends through a different
  // route, and "open your built deck for trade" is not a thing anyone means.
  const tradableCandidates = tree.filter((l) => l.type !== "deck");
  const openForTrade = tradableCandidates.filter((l) => l.is_tradable);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        subtitle="Where your cards physically live. Deleting a location never deletes cards — they become unsorted, and anything nested inside moves up a level."
      />

      {/*
        The trade prompt.

        Marking a location tradable is the only switch that makes anything you
        own visible to another person, and until now it lived five sections down
        the Friends page — so the usual outcome was a collection nobody could
        see and a trading half that silently did nothing. Said here, once,
        while there is still nothing open.
      */}
      {tradableCandidates.length > 0 && openForTrade.length === 0 ? (
        <Banner kind="success">
          No locations are public yet, so friends cannot see any of your cards. Switch a
          binder or box to <strong>Public</strong> below — that is what puts it in
          front of them.
        </Banner>
      ) : null}

      <LocationManager
        tree={tree}
        topLevel={tree}
        peek={peek}
        counts={counts}
        stats={stats}
        unsortedCount={unsortedCount}
      />

      {tree.length === 0 ? (
        <EmptyState title="No locations yet.">
          A location is a real place — a binder, a deck box, a shoebox. Create one above,
          then file cards into it from your collection.
        </EmptyState>
      ) : null}
    </div>
  );
}
