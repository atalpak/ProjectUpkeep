import Link from "next/link";
import { notFound } from "next/navigation";

import { getProfileByUsername, getPublicDecks, getPublicDeckList } from "@/lib/social/queries";
import { groupDeck } from "@/lib/collection/deck-view";
import { cardDisplayName } from "@/lib/types";
import { ManaCost } from "@/components/ManaCost";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Deck · Project Upkeep" };

/**
 * Never prerendered — same reasoning as the profile page it hangs off of:
 * this depends on who is signed in and who they are friends with, so every
 * request has to reach the server.
 */
export const dynamic = "force-dynamic";

/**
 * A friend's decklist, read-only.
 *
 * Deliberately not `DeckWorkspace` — that component is action-bearing
 * throughout (sleeve, unsleeve, reorder, bulk-edit) and every one of those
 * actions assumes the deck is yours. This renders the same grouped shape
 * (`groupDeck`) with none of them: no sleeved/available state, because that
 * lives in `card_instances`, which `getPublicDeckList` never reads, and no
 * notes, because migration 35's decklist-sharing does not extend to them.
 *
 * A deck id that is not actually public to the viewer is not distinguished
 * from one that does not exist — `getPublicDecks` (RLS, migration 35) simply
 * returns nothing for it, so both cases 404 the same way.
 */
export default async function FriendDeckPage({
  params,
}: {
  params: Promise<{ username: string; deckId: string }>;
}) {
  const { username, deckId } = await params;

  const profile = await getProfileByUsername(decodeURIComponent(username));
  if (!profile) notFound();

  const [decks, entries] = await Promise.all([
    getPublicDecks(profile.id),
    getPublicDeckList(deckId),
  ]);

  const deck = decks.find((d) => d.id === deckId);
  if (!deck) notFound();

  const commanderEntry = deck.commander_card_id
    ? (entries.find((e) => e.card_id === deck.commander_card_id) ?? null)
    : null;

  const groups = groupDeck(entries, "name", commanderEntry?.id ?? null, {
    alwaysIncludeCommander: false,
  });

  const cardCount = entries.reduce((sum, e) => sum + e.quantity, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${deck.name}`}
        subtitle={`${profile.username}'s deck · ${cardCount} card${cardCount === 1 ? "" : "s"} on the list`}
        backHref={`/u/${encodeURIComponent(username)}`}
        backLabel={profile.username}
      />

      {(deck.format || deck.tags.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {deck.format ? <Badge>{deck.format}</Badge> : null}
          {deck.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState title="Nothing on this list yet.">
          {profile.username} hasn&apos;t added any cards to this deck&apos;s list.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.section} className="space-y-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.label} · {group.cardCount}
              </h2>
              <div className="divide-y divide-border rounded-lg border border-border bg-surface">
                {group.rows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                      {row.quantity}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.cards ? cardDisplayName(row.cards) : "Unknown card"}
                    </span>
                    <ManaCost cost={row.cards?.mana_cost} size="xs" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-muted">
        This is {profile.username}&apos;s decklist — what they physically have sleeved is theirs to
        show, not this page&apos;s.{" "}
        <Link href={`/u/${encodeURIComponent(username)}`} className="text-accent underline">
          Back to their profile
        </Link>
        .
      </p>
    </div>
  );
}
