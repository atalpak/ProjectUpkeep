import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAvailability,
  getDeck,
  getDeckContents,
  getDeckList,
  getDeckWishList,
  getSpareLocations,
  strandedInDeck,
  type DeckListEntry,
} from "@/lib/collection/queries";
import { availabilityFor, cardKey } from "@/lib/collection/availability";
import { countsFor, deckProgress } from "@/lib/collection/deck-state";
import { computeDeckStats } from "@/lib/collection/deck-stats";
import { groupDeck } from "@/lib/collection/deck-view";
import { deckToDecklistText, toCsv, type ExportRow } from "@/lib/collection/export";
import { matchSuppliersFor } from "@/lib/social/queries";
import type { WantRow } from "@/lib/social/wants";
import { cardDisplayName, type CardInstanceWithCard } from "@/lib/types";
import { DeckBanner } from "@/components/decks/DeckBanner";
import { DeckCharts } from "@/components/decks/DeckCharts";
import { DeckWorkspace, type WishSupplierView } from "@/components/decks/DeckWorkspace";
import { PlaytestLauncher } from "@/components/decks/PlaytestLauncher";
import { ExportButtons } from "@/components/ExportButtons";

/**
 * A decklist entry names a card, not a specific printing someone owns yet
 * (see DeckListEntry in src/lib/collection/queries.ts) — so it carries no
 * finish/condition/language, unlike a physical stack.
 */
function listEntryToExportRow(entry: DeckListEntry): ExportRow {
  return {
    card: entry.cards
      ? { name: entry.cards.name, setCode: entry.cards.set_code, collectorNumber: entry.cards.collector_number }
      : null,
    quantity: entry.quantity,
    // A list entry has no finish, but if every sleeved copy is one non-plain
    // finish the export should say so (`*F*` / `*E*`).
    finish: entry.sleevedFinishes.length === 1 ? entry.sleevedFinishes[0] : null,
    condition: null,
    language: null,
    locationName: null,
  };
}

/**
 * A physical stack sleeved into this deck. Location is dropped rather than
 * populated: every row here lives in this one deck, so the column would just
 * repeat the deck's own name on every line.
 */
function contentRowToExportRow(row: CardInstanceWithCard): ExportRow {
  return {
    card: row.cards
      ? { name: row.cards.name, setCode: row.cards.set_code, collectorNumber: row.cards.collector_number }
      : null,
    quantity: row.quantity,
    finish: row.finish,
    condition: row.condition,
    language: row.language,
    locationName: null,
  };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
}

export const metadata = { title: "Deck · Project Upkeep" };

/**
 * Never prerendered.
 *
 * Without this, Next tries to generate static paths for the [id] segment and
 * the worker doing it dies, which surfaces in the browser as "Failed to fetch".
 * A deck belongs to the signed-in user, so every request has to reach the
 * server anyway. Same fix as src/app/api/cards/[id]/route.ts.
 */
export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const deck = await getDeck(id);
  if (!deck) notFound();

  const [entries, contents, availability, spareLocations, wishList] = await Promise.all([
    getDeckList(id),
    getDeckContents(id),
    getAvailability(),
    getSpareLocations(),
    getDeckWishList(id),
  ]);

  // The commander names a card directly (migration 00000000000018), so
  // finding its list entry is one direct match — no more going by way of a
  // physical copy that might not even exist. `Location` already declares
  // this field, so there is nothing to cast.
  const commanderCardId = deck.commander_card_id;
  const commanderEntry =
    commanderCardId === null
      ? null
      : (entries.find((entry) => entry.card_id === commanderCardId) ?? null);
  const commanderEntryId = commanderEntry?.id ?? null;
  // The full-resolution image, already on the entry via CARD_FIELDS
  // (getDeckList) — no extra read. The list page uses the small thumbnail for
  // a row; this page renders the commander much larger, so it asks for the
  // bigger source image instead.
  const commanderImage = commanderEntry?.cards?.image_uri ?? null;
  const commanderName = commanderEntry?.cards ? cardDisplayName(commanderEntry.cards) : null;

  // Same per-entry state the list rows and the top-of-page progress line have
  // always used (see DeckWorkspace) — computed once here so the banner can
  // show it without duplicating the logic in a second, client-side pass.
  const progress = deckProgress(
    entries.map((entry) =>
      countsFor(entry.quantity, entry.sleeved, availabilityFor(availability, entry.cards)),
    ),
  );

  // Who in your circle already has a wish-list card open for trade — the same
  // matching /wants does, scoped to just this deck's wishes so a deck page
  // does not pay for a full want-list load it does not need.
  const wishAsWants: WantRow[] = wishList.map((w) => ({
    id: w.id,
    key: cardKey(w.cards) ?? `id:${w.card_id}`,
    name: w.cards?.name ?? "Unknown card",
    displayName: w.cards ? cardDisplayName(w.cards) : "Unknown card",
    cardId: w.cards?.scryfall_id ?? w.card_id,
    image: w.cards?.image_uri_small ?? null,
    quantity: w.quantity,
    note: w.note,
  }));
  const { matches: wishMatches, suppliers: wishSuppliers } = await matchSuppliersFor(wishAsWants);

  // Resolved to plain data here, same as /wants does, so the client component
  // gets usernames rather than a Profile it has no other use for.
  const wishMatchesView: Record<string, WishSupplierView[]> = {};
  for (const [wantId, list] of wishMatches) {
    wishMatchesView[wantId] = list.map((s) => ({
      username: wishSuppliers.get(s.ownerId)?.username ?? "a friend",
      available: s.available,
      locations: s.locations,
    }));
  }

  // The same "does a friend have this?" question, asked for the main
  // decklist's Missing rows instead of the wish list — a throwaway want row
  // per short entry, the same way /decks/check matches its "not owned" rows,
  // rather than something saved to the database. Keyed by the decklist
  // entry's own id: unlike the wish list, these have no want_list row of
  // their own to key on.
  const missingWants: WantRow[] = entries
    .filter(
      (entry) =>
        countsFor(entry.quantity, entry.sleeved, availabilityFor(availability, entry.cards))
          .state === "missing",
    )
    .map((entry) => ({
      id: entry.id,
      key: cardKey(entry.cards) ?? `id:${entry.card_id}`,
      name: entry.cards?.name ?? "Unknown card",
      displayName: entry.cards ? cardDisplayName(entry.cards) : "Unknown card",
      cardId: entry.cards?.scryfall_id ?? entry.card_id,
      image: entry.cards?.image_uri_small ?? null,
      quantity: entry.quantity,
      note: null,
    }));
  const { matches: missingMatches, suppliers: missingSuppliers } =
    await matchSuppliersFor(missingWants);

  const missingSupplyView: Record<string, WishSupplierView[]> = {};
  for (const [entryId, list] of missingMatches) {
    missingSupplyView[entryId] = list.map((s) => ({
      username: missingSuppliers.get(s.ownerId)?.username ?? "a friend",
      available: s.available,
      locations: s.locations,
    }));
  }

  // The decklist half of the export, grouped the same way the page itself
  // groups it (src/lib/collection/deck-view.ts), with the commander split out
  // into its own bare-header block the way Moxfield/Archidekt expect — see
  // deckToDecklistText's own tests in scripts/export.test.ts. Sorted by name:
  // the export is computed once, server-side, rather than following whatever
  // sort the page happens to be showing at the moment someone clicks export.
  const exportGroups = groupDeck(entries, "name", commanderEntryId);
  const commanderGroup = exportGroups.find((g) => g.section === "commander");
  const deckDecklistText = deckToDecklistText(
    commanderGroup?.rows[0] ? listEntryToExportRow(commanderGroup.rows[0]) : null,
    exportGroups
      .filter((g) => g.section !== "commander")
      .map((g) => ({ label: g.label, rows: g.rows.map(listEntryToExportRow) })),
  );

  // The CSV half is full per-stack detail (finish/condition/language), which
  // only a physical copy has — the decklist above names cards the deck wants,
  // this is what is actually sleeved in the box for it.
  const deckCsv = toCsv(contents.map(contentRowToExportRow), { includeLocation: false });

  const stats = computeDeckStats(entries, commanderEntryId);

  return (
    <div className="space-y-5">
      <Link href="/decks" className="text-sm text-accent underline">
        ← All decks
      </Link>

      <DeckBanner
        deck={deck}
        commanderImage={commanderImage}
        commanderName={commanderName}
        progress={progress}
        price={stats.price}
        actions={
          <>
            {/* /decks/[id]/test still exists as a real route — the deep
                link and refresh-safe fallback — but from here Playtest
                opens as a near-fullscreen popup instead of a navigation.
                No new queries: entries and commanderCardId are already
                loaded above for the page itself. */}
            <PlaytestLauncher
              deckName={deck.name}
              entries={entries}
              commanderCardId={commanderCardId}
            />
            {entries.length > 0 || contents.length > 0 ? (
              <ExportButtons
                // Inline: a deck is a hundred rows the page already holds.
                source={{ kind: "inline", decklistText: deckDecklistText, csv: deckCsv }}
                filenameBase={`deck-${slugify(deck.name)}`}
              />
            ) : null}
          </>
        }
      />

      <DeckWorkspace
        deckId={id}
        entries={entries}
        stranded={strandedInDeck(contents, entries)}
        availability={availability}
        spareLocations={spareLocations}
        commanderEntryId={commanderEntryId}
        price={stats.price}
        wishList={wishList}
        wishMatches={wishMatchesView}
        missingSupply={missingSupplyView}
      />

      {entries.length > 0 ? <DeckCharts stats={stats} /> : null}
    </div>
  );
}
