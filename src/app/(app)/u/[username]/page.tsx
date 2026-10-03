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
  getPublicDecks,
  getTradableCards,
  getTrade,
  getWantList,
} from "@/lib/social/queries";
import { tradingAllowed } from "@/lib/social/tos";
import { mirrorTradeForCounter } from "@/lib/social/counter";
import { matchWants, type WantRow } from "@/lib/social/wants";
import { ProfilePublicDecks } from "@/components/social/ProfilePublicDecks";
import { ProfileIdentity } from "@/components/social/ProfileIdentity";
import { ProfileFriendRequest } from "@/components/social/ProfileFriendRequest";
import { ProfileSection } from "@/components/social/ProfileSection";
import { ProfileSectionJump } from "@/components/social/ProfileSectionJump";
import { ProfileTradables } from "@/components/social/ProfileTradables";
import { ProfileWants, type ProfileWantCard, type ProfileWantMatch } from "@/components/social/ProfileWants";
import { TradableBinderPreview } from "@/components/social/TradableBinderPreview";
import { EmptyState } from "@/components/ui";
import type { PublicDeckSummary } from "@/lib/social/queries";
import { MortStage } from "@/components/mort/MortStage";

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
  searchParams: Promise<{ counter?: string | string[]; view?: string | string[] }>;
}) {
  const { username } = await params;
  const query = await searchParams;
  const counterId = one(query.counter);
  const friendPreview = one(query.view) === "friend";

  // The profile lookup and "who am I" are independent, so resolve them together:
  // one serial phase before either the self branch or the friend-path Promise.all.
  const [profile, user] = await Promise.all([
    getProfileByUsername(decodeURIComponent(username)),
    getCurrentUser(),
  ]);
  if (!profile) notFound();

  // Your own handle: the full page, with an optional friend-view preview.
  // The trade-proposal builder and want-matching below are friend-interaction
  // only — you cannot trade with yourself, and matching your binder against
  // your own wants is noise — so this branch runs none of it.
  if (user && profile.id === user.id) {
    const [myTradableCards, myWants, myPublicDecks] = await Promise.all([
      getMyTradableCards(),
      getWantList(),
      getPublicDecks(user.id),
    ]);

    const stacks = myTradableCards.length;
    const totalCards = myTradableCards.reduce((sum, r) => sum + r.quantity, 0);
    const { featuredDecks, otherDecks } = splitFeaturedDecks(myPublicDecks, profile.featured_deck_ids);

    return (
      <div className="space-y-5">
        <ProfileIdentity
          profile={profile}
          context={friendPreview ? "Friend view preview" : "Your profile"}
          actions={
            friendPreview ? (
              <Link href={`/u/${encodeURIComponent(profile.username)}`} className="text-sm text-accent-text underline">Exit preview</Link>
            ) : (
              <>
                <Link href="/settings#profile" className="text-sm text-accent-text underline">Edit profile</Link>
                <Link href={`/u/${encodeURIComponent(profile.username)}?view=friend`} className="text-sm text-accent-text underline">View as friend</Link>
              </>
            )
          }
        />

        {!friendPreview ? (
          <p className="text-sm text-ink-muted">Your identity is visible to signed-in members. Your shared decks, wish list and trade binder are visible to friends.</p>
        ) : null}

        {featuredDecks.length > 0 ? <DeckSection id="featured-deck" title={featuredDecks.length === 1 ? "Featured deck" : `Featured decks · ${featuredDecks.length}`} username={profile.username} decks={featuredDecks} open /> : null}
        {otherDecks.length > 0 ? <DeckSection id="shared-decks" title={`Shared decks · ${otherDecks.length}`} username={profile.username} decks={otherDecks} /> : null}

        <ProfileSection id="wish-list" title={`Wish list · ${myWants.length} card${myWants.length === 1 ? "" : "s"}`}>
          <ProfileWants wants={profileWantCards(myWants)} />
        </ProfileSection>

        <ProfileSection id="trade-binder" title={`Trade binder · ${totalCards} cards (${stacks} unique)`}>
          {stacks === 0 ? (
            <EmptyState
              title="Nothing of yours is open for trade."
              icon={<MortStage size="s" reaction="idle" animated={false} />}
            >
              Mark a binder or box tradable on the{" "}
              <Link href="/locations" className="text-accent-text underline">
                Locations page
              </Link>{" "}
              and it will show here.
            </EmptyState>
          ) : (
            <TradableBinderPreview cards={myTradableCards} />
          )}
        </ProfileSection>

      </div>
    );
  }

  const [edges, theirCards, myCards, tos, theirWants, myTradables, theirPublicDecks] =
    await Promise.all([
      getFriendEdges(),
      // Returns nothing unless the policies allow it — being friends is enforced
      // by the database, not by the check below, which only decides what to say.
      getTradableCards(profile.id),
      getMyTradableCards(),
      getMyTosStatus(),
      // Readable only if you are friends (migration 15 policy); [] otherwise.
      getFriendWants(profile.id),
      getMyTradablesForMatching(),
      // Same shape: empty unless is_public + are_friends both hold
      // (migration 35 policy on locations).
      getPublicDecks(profile.id),
    ]);

  // Their want list, flagged with how many of each you have open for trade.
  const iCanFill = matchWants(theirWants, myTradables);
  const wantsIFill = theirWants.filter((w) => iCanFill.has(w.id)).length;
  const wantMatches: Record<string, ProfileWantMatch> = {};
  for (const want of theirWants) {
    const supply = iCanFill.get(want.id)?.[0];
    if (supply) wantMatches[want.id] = { available: supply.available, locations: supply.locations };
  }

  const friendship = [...edges.friends, ...edges.incoming, ...edges.outgoing].find(
    (e) => e.profile.id === profile.id,
  );
  const isFriend = friendship?.friendship.status === "accepted";
  const tosAccepted = tradingAllowed(tos);
  const { featuredDecks, otherDecks } = splitFeaturedDecks(theirPublicDecks, profile.featured_deck_ids);

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
      <ProfileIdentity
        profile={profile}
        context={isFriend ? "Friend" : friendship?.direction === "incoming" ? "Sent you a friend request" : friendship?.direction === "outgoing" ? "Friend request pending" : "Member"}
        actions={isFriend ? (
          <ProfileSectionJump id="trade-binder">View trade binder</ProfileSectionJump>
        ) : friendship ? (
          <Link href="/friends" className="text-sm text-accent-text underline">Manage request</Link>
        ) : (
          <ProfileFriendRequest profileId={profile.id} />
        )}
      />

      {isFriend && featuredDecks.length > 0 ? <DeckSection id="featured-deck" title={featuredDecks.length === 1 ? "Featured deck" : `Featured decks · ${featuredDecks.length}`} username={profile.username} decks={featuredDecks} open /> : null}
      {isFriend && otherDecks.length > 0 ? <DeckSection id="shared-decks" title={`Shared decks · ${otherDecks.length}`} username={profile.username} decks={otherDecks} /> : null}

      {isFriend ? (
        <ProfileSection id="wish-list" title={`Wish list · ${theirWants.length} card${theirWants.length === 1 ? "" : "s"}${wantsIFill > 0 ? ` · you have ${wantsIFill}` : ""}`}>
          <ProfileWants wants={profileWantCards(theirWants)} matches={wantMatches} />
        </ProfileSection>
      ) : null}

      <ProfileSection id="trade-binder" title={isFriend ? `Trade binder · ${theirCards.reduce((sum, card) => sum + card.quantity, 0)} cards` : "Trade binder · Friends only"} open={Boolean(counterOf)}>
        {!isFriend ? (
          <EmptyState
            title="Only friends can see a trade binder."
            icon={<MortStage size="s" reaction="annoyed" animated={false} />}
          >
            {friendship
              ? "There is already a request between you two — check the friends page."
              : "Send a friend request above to see shared decks, wishes and cards."}
          </EmptyState>
        ) : theirCards.length === 0 ? (
          <EmptyState
            title={`${profile.username} has nothing open for trade.`}
            icon={<MortStage size="s" reaction="idle" animated={false} />}
          >
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
      </ProfileSection>

    </div>
  );
}

/** Never serialize private notes or the owner's deck tags into the client profile. */
function profileWantCards(wants: WantRow[]): ProfileWantCard[] {
  return wants.map(({ id, displayName, cardId, image, imageLarge, flip, quantity }) => ({
    id, displayName, cardId, image, imageLarge, flip, quantity,
  }));
}

function splitFeaturedDecks(decks: PublicDeckSummary[], ids: string[]) {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  const featuredDecks = ids.flatMap((id) => {
    const deck = byId.get(id);
    return deck ? [deck] : [];
  });
  const featuredIds = new Set(featuredDecks.map((deck) => deck.id));
  return { featuredDecks, otherDecks: decks.filter((deck) => !featuredIds.has(deck.id)) };
}

function DeckSection({ id, title, username, decks, open = false }: { id: string; title: string; username: string; decks: PublicDeckSummary[]; open?: boolean }) {
  return (
    <ProfileSection id={id} title={title} open={open}>
      <ProfilePublicDecks username={username} decks={decks} />
    </ProfileSection>
  );
}
