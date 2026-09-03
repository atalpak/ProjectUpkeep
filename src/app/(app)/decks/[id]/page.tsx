import { notFound } from "next/navigation";

import {
  getAvailability,
  getDeck,
  getDeckContents,
  getDeckList,
  strandedInDeck,
} from "@/lib/collection/queries";
import { cardKey } from "@/lib/collection/availability";
import { DeckWorkspace } from "@/components/decks/DeckWorkspace";
import { PageHeader } from "@/components/ui";

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

  const [entries, contents, availability] = await Promise.all([
    getDeckList(id),
    getDeckContents(id),
    getAvailability(),
  ]);

  // The commander is stored as a card_instance, but the list is what is drawn.
  // Match the two by card identity so the nominated card heads its own section.
  const commanderInstanceId =
    (deck as { commander_instance_id?: string | null }).commander_instance_id ?? null;
  const commanderCard = contents.find((row) => row.id === commanderInstanceId)?.cards ?? null;
  const commanderKey = cardKey(commanderCard);
  const commanderEntryId =
    commanderKey === null
      ? null
      : (entries.find((entry) => cardKey(entry.cards) === commanderKey)?.id ?? null);

  return (
    <div className="space-y-5">
      <PageHeader title={deck.name} backHref="/decks" backLabel="All decks" />

      <DeckWorkspace
        deckId={id}
        entries={entries}
        stranded={strandedInDeck(contents, entries)}
        availability={availability}
        commanderEntryId={commanderEntryId}
      />
    </div>
  );
}
