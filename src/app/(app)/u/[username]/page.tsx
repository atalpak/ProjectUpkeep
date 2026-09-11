import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import {
  getFriendEdges,
  getFriendWants,
  getMyTosStatus,
  getMyTradableCards,
  getMyTradablesForMatching,
  getProfileByUsername,
  getTradableCards,
  getTrade,
  getWantList,
} from "@/lib/social/queries";
import { tradingAllowed } from "@/lib/social/tos";
import { mirrorTradeForCounter } from "@/lib/social/counter";
import { matchWants } from "@/lib/social/wants";
import { ProfileTradables } from "@/components/social/ProfileTradables";
import { TradableBinderPreview } from "@/components/social/TradableBinderPreview";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Profile · Project Upkeep" };

/**
 * Never prerendered: the page depends on who is signed in and who they are
 * friends with. Same reasoning as /decks/[id] and /api/cards/[id].
 */
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ counter?: string | string[] }>;
}) {
  const { username } = await params;
  const counterId = one((await searchParams).counter);

  // The profile lookup and "who am I" are independent, so resolve them together:
  // one serial phase before either the self branch or the friend-path Promise.all.
  const [profile, user] = await Promise.all([
    getProfileByUsername(decodeURIComponent(username)),
    getCurrentUser(),
  ]);
  if (!profile) notFound();

  // Your own handle: a read-only preview of what a friend sees on this page.
  // The trade-proposal builder and want-matching below are friend-interaction
  // only — you cannot trade with yourself, and matching your binder against
  // your own wants is noise — so this branch runs none of it.
  if (user && profile.id === user.id) {
    const [myTradableCards, myWants] = await Promise.all([
      getMyTradableCards(),
      getWantList(),
    ]);

    const stacks = myTradableCards.length;
    const totalCards = myTradableCards.reduce((sum, r) => sum + r.quantity, 0);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Your public profile"
          subtitle={
            stacks === 0
              ? "What a friend sees when they open your profile."
              : `What a friend sees of your trade binder — ${stacks} stack${
                  stacks === 1 ? "" : "s"
                }, ${totalCards} card${totalCards === 1 ? "" : "s"} open for trade.`
          }
          backHref="/settings"
          backLabel="Settings"
        />

        {myWants.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">
              Your wish list · {myWants.length} card{myWants.length === 1 ? "" : "s"}
            </h2>
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {myWants.map((want) => (
                <li
                  key={want.id}
                  className="rounded border border-border px-1.5 py-0.5 text-ink-muted"
                >
                  {want.displayName}
                  {want.quantity > 1 ? ` ×${want.quantity}` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              A friend sees this list on your profile alongside your binder.
            </p>
          </section>
        ) : null}

        {stacks === 0 ? (
          <EmptyState title="Nothing of yours is open for trade.">
            Mark a binder or box tradable on the{" "}
            <Link href="/locations" className="text-accent underline">
              Locations page
            </Link>{" "}
            and it will show here.
          </EmptyState>
        ) : (
          <TradableBinderPreview cards={myTradableCards} />
        )}
      </div>
    );
  }

  const [edges, theirCards, myCards, tos, theirWants, myTradables] = await Promise.all([
    getFriendEdges(),
    // Returns nothing unless the policies allow it — being friends is enforced
    // by the database, not by the check below, which only decides what to say.
    getTradableCards(profile.id),
    getMyTradableCards(),
    getMyTosStatus(),
    // Readable only if you are friends (migration 15 policy); [] otherwise.
    getFriendWants(profile.id),
    getMyTradablesForMatching(),
  ]);

  // Their want list, flagged with how many of each you have open for trade.
  const iCanFill = matchWants(theirWants, myTradables);
  const wantsIFill = theirWants.filter((w) => iCanFill.has(w.id)).length;

  const friendship = [...edges.friends, ...edges.incoming, ...edges.outgoing].find(
    (e) => e.profile.id === profile.id,
  );
  const isFriend = friendship?.friendship.status === "accepted";
  const tosAccepted = tradingAllowed(tos);

  // If we arrived to counter an offer, load it and confirm it is one this user
  // may still counter and that it is with this profile.
  let counterOf: string | undefined;
  let seededOffering: Record<string, number> | undefined;
  let seededRequesting: Record<string, number> | undefined;

  if (counterId && user) {
    const trade = await getTrade(counterId);
    const stillOpen = trade && ["proposed", "countered"].includes(trade.status);
    const mineToCounter = trade?.recipient_id === user.id;
    const withThisProfile = trade?.proposer_id === profile.id;

    if (trade && stillOpen && mineToCounter && withThisProfile) {
      counterOf = trade.id;
      const seed = mirrorTradeForCounter(
        trade.items.map((i) => ({
          direction: i.direction,
          quantity: i.quantity,
          instanceId: i.instance?.id ?? null,
        })),
        myCards.map((c) => c.id),
        theirCards.map((c) => c.id),
      );
      seededOffering = seed.offering;
      seededRequesting = seed.requesting;
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={profile.username}
        subtitle={
          isFriend
            ? `${theirCards.length} stacks open for trade`
            : "You are not friends yet."
        }
        backHref="/friends"
        backLabel="Friends"
      />

      {isFriend && theirWants.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">
            {profile.username} is after {theirWants.length} card
            {theirWants.length === 1 ? "" : "s"}
            {wantsIFill > 0 ? (
              <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">
                you have {wantsIFill}
              </span>
            ) : null}
          </h2>
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {theirWants.map((want) => {
              const mine = iCanFill.get(want.id)?.[0]?.available ?? 0;
              return (
                <li
                  key={want.id}
                  className={`rounded border px-1.5 py-0.5 ${
                    mine > 0 ? "border-accent bg-accent-soft" : "border-border text-ink-muted"
                  }`}
                >
                  {want.displayName}
                  {want.quantity > 1 ? ` ×${want.quantity}` : ""}
                  {mine > 0 ? <span className="ml-1 text-xs">· you have {mine}</span> : null}
                </li>
              );
            })}
          </ul>
          {wantsIFill > 0 ? (
            <p className="text-xs text-ink-muted">
              Highlighted cards are open in your trade binder — offer them below.
            </p>
          ) : null}
        </section>
      ) : null}

      {!isFriend ? (
        <EmptyState title="Only friends can see a trade binder.">
          {friendship
            ? "There is already a request between you two — check the friends page."
            : "Send them a friend request from the friends page first."}
        </EmptyState>
      ) : theirCards.length === 0 ? (
        <EmptyState title={`${profile.username} has nothing open for trade.`}>
          They need to mark a binder or box as tradable before anything shows here.
        </EmptyState>
      ) : (
        <ProfileTradables
          recipientId={profile.id}
          recipientName={profile.username}
          theirCards={theirCards}
          myCards={myCards}
          tosAccepted={tosAccepted}
          counterOf={counterOf}
          initialOffering={seededOffering}
          initialRequesting={seededRequesting}
          startTrading={Boolean(counterOf)}
        />
      )}
    </div>
  );
}
