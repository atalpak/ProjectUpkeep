import { notFound } from "next/navigation";

import { PlayBoard } from "@/components/playtester/PlayBoard";
import { PageHeader } from "@/components/ui";
import { getDeck, getDeckList } from "@/lib/collection/queries";

export const metadata = { title: "Play · Project Upkeep" };

/**
 * Never prerendered — same reasoning as `/decks/[id]` and `/decks/[id]/test`:
 * a deck belongs to the signed-in user, so every request has to reach the
 * server anyway, and Next would otherwise try (and fail) to generate a
 * static path for the `[id]` segment.
 */
export const dynamic = "force-dynamic";

/**
 * The tactile solo tabletop (plan section 4.5, BACKLOG.md item 24 Phase 2).
 *
 * Deliberately thin, the same shape as `/decks/[id]/test`: validate ownership
 * with `getDeck()`, load the decklist once with `getDeckList()`, and hand both
 * to a client component that owns the entire game loop from there. There is
 * no server action or API route on this page or anywhere under
 * `src/components/playtester/` — every draw, tap, move and undo happens
 * locally in the browser against `src/lib/playtest/board/**`'s pure reducer,
 * and none of it ever reaches `card_instances`, `deck_cards` or `locations`.
 * `game-start.ts` (already Phase 1, already tested) is the one seam between
 * this server-loaded data and the client's `GameState` — it runs inside
 * `PlayBoard`, not here, so this route does no reducer work of its own.
 */
export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const deck = await getDeck(id);
  if (!deck) notFound();

  const entries = await getDeckList(id);

  return (
    <div className="space-y-4">
      <PageHeader title={`Play — ${deck.name}`} backHref={`/decks/${id}`} backLabel="Back to deck" />

      <PlayBoard deckId={id} deckName={deck.name} entries={entries} commanderCardId={deck.commander_card_id} />
    </div>
  );
}
