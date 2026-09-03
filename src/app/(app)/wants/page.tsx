import { getWantListView } from "@/lib/social/queries";
import { getDecks } from "@/lib/collection/queries";
import {
  WantListManager,
  type SupplierView,
} from "@/components/social/WantListManager";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Wish List · Project Upkeep" };

/**
 * The wish list.
 *
 * Cards you are chasing, each annotated with which friends have it sitting in a
 * trade binder right now — the difference between a trade tool you have to
 * drive and one that tells you when there is something to do.
 */
export default async function WantsPage() {
  // Decks, for the "which deck is this for" tag on each row — the same list
  // the deck picker on a deck's own wish list draws from.
  const [{ wants, matches, suppliers }, decks] = await Promise.all([
    getWantListView(),
    getDecks(),
  ]);

  // Resolve each supplier id to a username here, so the client gets plain data.
  const matchesView: Record<string, SupplierView[]> = {};
  for (const [wantId, list] of matches) {
    matchesView[wantId] = list.map((s) => ({
      userId: s.ownerId,
      username: suppliers.get(s.ownerId)?.username ?? "a friend",
      available: s.available,
      locations: s.locations,
    }));
  }

  const availableCount = matches.size;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Wish List"
        subtitle={
          wants.length === 0
            ? "Track the cards you are after."
            : availableCount > 0
              ? `${availableCount} of the ${wants.length} card${
                  wants.length === 1 ? "" : "s"
                } on your wish list ${availableCount === 1 ? "is" : "are"} available from a friend right now.`
              : `None of the ${wants.length} card${
                  wants.length === 1 ? "" : "s"
                } on your wish list are open for trade in your circle yet.`
        }
      />

      <WantListManager
        wants={wants}
        matches={matchesView}
        decks={decks.map((d) => ({ id: d.id, name: d.name }))}
      />
    </div>
  );
}
