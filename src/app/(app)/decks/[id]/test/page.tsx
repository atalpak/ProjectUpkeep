import { notFound } from "next/navigation";

import { Playtest } from "@/components/decks/Playtest";
import { PageHeader } from "@/components/ui";
import { getDeck, getDeckList } from "@/lib/collection/queries";

export const metadata = { title: "Playtest · Project Upkeep" };

/**
 * Never prerendered.
 *
 * Without this, Next tries to generate static paths for the [id] segment and
 * the worker doing it dies, which surfaces in the browser as "Failed to fetch".
 * A deck belongs to the signed-in user, so every request has to reach the
 * server anyway. Same fix as src/app/api/cards/[id]/route.ts.
 */
export const dynamic = "force-dynamic";

/**
 * The goldfishing consistency lab for one deck. The server side of this page
 * is deliberately thin: load the deck and its list once, the same way the
 * deck page itself does, and hand it to a client component that runs every
 * simulation locally — see Playtest.tsx. There is no API route and no server
 * action here on purpose; a re-run should never cost a round trip.
 */
export default async function PlaytestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const deck = await getDeck(id);
  if (!deck) notFound();

  const entries = await getDeckList(id);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Playtest — ${deck.name}`}
        backHref={`/decks/${id}`}
        backLabel="Back to deck"
      />

      <Playtest entries={entries} commanderCardId={deck.commander_card_id} />
    </div>
  );
}
