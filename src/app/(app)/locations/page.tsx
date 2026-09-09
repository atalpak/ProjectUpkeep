import Image from "next/image";
import Link from "next/link";

import { getLocationTree, UNSORTED } from "@/lib/collection/queries";
import { LocationManager } from "@/components/LocationManager";
import { Banner, Card as Panel, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Locations · Project Upkeep" };

export default async function LocationsPage() {
  const { tree, unsortedCount, peek, counts, stats } = await getLocationTree();

  const unsortedPeek = peek.get(UNSORTED) ?? [];

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
          Nothing is open for trade yet, so friends cannot see any of your cards. Switch a
          binder or box to <strong>Open for trade</strong> below — that is what puts it in
          front of them.
        </Banner>
      ) : null}

      {/* Unsorted is a first-class place, not an error state, so it gets a real
          row rather than being hidden behind a filter. */}
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/collection?location=${UNSORTED}`}
            className="font-medium hover:underline"
          >
            Unsorted
          </Link>
          <p className="text-xs text-ink-muted">
            {unsortedCount === 0
              ? "Everything you own is filed somewhere."
              : "Cards you own but haven't filed anywhere yet."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {unsortedPeek.length > 0 ? (
            <div className="flex items-center" aria-hidden="true">
              {unsortedPeek.map((src, i) => (
                <Image
                  key={`${src}-${i}`}
                  src={src}
                  alt=""
                  width={146}
                  height={204}
                  unoptimized
                  className={`h-11 w-8 rounded-[3px] border border-border object-cover object-top${
                    i > 0 ? " -ml-5" : ""
                  }`}
                />
              ))}
            </div>
          ) : null}
          <span className="text-sm tabular-nums text-ink-muted">
            {unsortedCount} card{unsortedCount === 1 ? "" : "s"}
          </span>
        </div>
      </Panel>

      <LocationManager
        tree={tree}
        topLevel={tree}
        peek={peek}
        counts={counts}
        stats={stats}
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
