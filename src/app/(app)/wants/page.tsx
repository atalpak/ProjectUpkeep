import { getWantListView } from "@/lib/social/queries";
import {
  WantListManager,
  type SupplierView,
} from "@/components/social/WantListManager";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Want list · MTGManager" };

/**
 * The want list.
 *
 * Cards you are chasing, each annotated with which friends have it sitting in a
 * trade binder right now — the difference between a trade tool you have to
 * drive and one that tells you when there is something to do.
 */
export default async function WantsPage() {
  const { wants, matches, suppliers } = await getWantListView();

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
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Want list"
        subtitle={
          wants.length === 0
            ? "Track the cards you are after."
            : availableCount > 0
              ? `${availableCount} of your ${wants.length} want${
                  wants.length === 1 ? "" : "s"
                } ${availableCount === 1 ? "is" : "are"} available from a friend right now.`
              : `None of your ${wants.length} want${
                  wants.length === 1 ? "" : "s"
                } are open for trade in your circle yet.`
        }
      />

      <WantListManager wants={wants} matches={matchesView} />
    </div>
  );
}
