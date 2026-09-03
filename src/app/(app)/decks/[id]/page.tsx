import { notFound } from "next/navigation";

import {
  getAvailability,
  getDeck,
  getDeckContents,
  getDeckList,
  getDeckWishList,
  strandedInDeck,
  type DeckListEntry,
} from "@/lib/collection/queries";
import { cardKey } from "@/lib/collection/availability";
import { groupDeck } from "@/lib/collection/deck-view";
import { deckToDecklistText, toCsv, type ExportRow } from "@/lib/collection/export";
import { matchSuppliersFor } from "@/lib/social/queries";
import type { WantRow } from "@/lib/social/wants";
import type { CardInstanceWithCard } from "@/lib/types";
import { DeckWorkspace, type WishSupplierView } from "@/components/decks/DeckWorkspace";
import { ExportButtons } from "@/components/ExportButtons";
import { PageHeader } from "@/components/ui";

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
    finish: null,
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

  const [entries, contents, availability, wishList] = await Promise.all([
    getDeckList(id),
    getDeckContents(id),
    getAvailability(),
    getDeckWishList(id),
  ]);

  // The commander names a card directly (migration 00000000000018), so
  // finding its list entry is one direct match — no more going by way of a
  // physical copy that might not even exist.
  const commanderCardId =
    (deck as { commander_card_id?: string | null }).commander_card_id ?? null;
  const commanderEntryId =
    commanderCardId === null
      ? null
      : (entries.find((entry) => entry.card_id === commanderCardId)?.id ?? null);

  // Who in your circle already has a wish-list card open for trade — the same
  // matching /wants does, scoped to just this deck's wishes so a deck page
  // does not pay for a full want-list load it does not need.
  const wishAsWants: WantRow[] = wishList.map((w) => ({
    id: w.id,
    key: cardKey(w.cards) ?? `id:${w.card_id}`,
    name: w.cards?.name ?? "Unknown card",
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={deck.name}
        backHref="/decks"
        backLabel="All decks"
        actions={
          entries.length > 0 || contents.length > 0 ? (
            <ExportButtons
              decklistText={deckDecklistText}
              csv={deckCsv}
              filenameBase={`deck-${slugify(deck.name)}`}
            />
          ) : null
        }
      />

      <DeckWorkspace
        deckId={id}
        entries={entries}
        stranded={strandedInDeck(contents, entries)}
        availability={availability}
        commanderEntryId={commanderEntryId}
        wishList={wishList}
        wishMatches={wishMatchesView}
      />
    </div>
  );
}
