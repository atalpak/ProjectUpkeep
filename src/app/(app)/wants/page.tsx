import Link from "next/link";

import { getFriendWantMatches, getWantListView } from "@/lib/social/queries";
import { describeSupplier } from "@/lib/social/wants";
import { getDecks } from "@/lib/collection/queries";
import {
  WantListManager,
  type SupplierView,
} from "@/components/social/WantListManager";
import { ExportButtons } from "@/components/ExportButtons";
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
  const [{ wants, matches, suppliers }, decks, friendMatches] = await Promise.all([
    getWantListView(),
    getDecks(),
    getFriendWantMatches(),
  ]);

  // Resolve each supplier id to a username here, so the client gets plain data.
  const matchesView: Record<string, SupplierView[]> = {};
  for (const [wantId, list] of matches) {
    matchesView[wantId] = list.map((s) => ({
      userId: s.ownerId,
      username: suppliers.get(s.ownerId)?.username ?? "a friend",
      available: s.available,
      locations: s.locations,
      languages: s.languages,
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
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/wants/import"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
            >
              Import
            </Link>
            <ExportButtons
              source={{ kind: "remote", href: "/api/wants/export" }}
              filenameBase="wish-list"
            />
          </div>
        }
      />

      <WantListManager
        wants={wants}
        matches={matchesView}
        decks={decks.map((d) => ({ id: d.id, name: d.name }))}
      />

      {friendMatches.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            You could offer these trades
          </h2>
          <div className="space-y-2">
            {friendMatches.map((m) => (
              <Link
                key={m.profile.id}
                href={`/u/${encodeURIComponent(m.profile.username)}`}
                className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-muted"
              >
                <p className="text-sm font-semibold">
                  {m.profile.username} wants {m.items.length} card{m.items.length === 1 ? "" : "s"} you have
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5 text-sm">
                  {m.items.map(({ want, available, locations, languages }) => (
                    <li
                      key={want.id}
                      className="rounded border border-accent bg-accent-soft px-1.5 py-0.5"
                    >
                      {want.displayName}
                      <span className="ml-1 text-xs text-ink-muted">
                        · you have {describeSupplier(available, locations, languages)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
