"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  acceptFriendRequest,
  removeFriendship,
  sendFriendRequest,
  setLocationTradable,
} from "@/app/(app)/friends/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { Banner, Button, Card as Panel, EmptyState, Input } from "@/components/ui";
import type { FriendEdge, Profile } from "@/lib/social/types";
import type { Location } from "@/lib/types";

/**
 * Friends, requests, and the switch that makes a binder tradable.
 *
 * The tradable switch lives here rather than on the locations page because it
 * is the only control in the app that shows anything to another person, and
 * that is easier to reason about when it sits next to the list of who those
 * people are.
 */
export function FriendsManager({
  friends,
  incoming,
  outgoing,
  results,
  query,
  locations,
}: {
  friends: FriendEdge[];
  incoming: FriendEdge[];
  outgoing: FriendEdge[];
  results: Profile[];
  query: string;
  locations: Array<Location & { is_tradable?: boolean }>;
}) {
  const [state, add, adding] = useActionState(sendFriendRequest, EMPTY_SOCIAL_STATE);
  const [search, setSearch] = useState(query);

  return (
    <div className="space-y-6">
      <Panel className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Find someone</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Search by username. Nothing of yours is visible to anyone until you are friends
            and you have marked a container as tradable.
          </p>
        </div>

        {/* A plain GET form: the search term lives in the URL, so the results
            survive a refresh and the server does the querying. */}
        <form method="get" className="flex flex-wrap gap-2">
          <Input
            name="q"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="username"
            className="max-w-xs"
          />
          <Button variant="secondary" type="submit">
            Search
          </Button>
        </form>

        <Banner kind="error">{state.error}</Banner>
        <Banner kind="success">{state.notice}</Banner>

        {query.trim().length >= 2 ? (
          results.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody matches “{query}”.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {results.map((profile) => (
                <li key={profile.id} className="flex items-center gap-3 px-3 py-2">
                  <Link
                    href={`/u/${profile.username}`}
                    className="flex-1 text-sm font-medium hover:underline"
                  >
                    {profile.username}
                  </Link>
                  <form action={add}>
                    <input type="hidden" name="addressee_id" value={profile.id} />
                    <Button variant="secondary" type="submit" disabled={adding} className="text-xs">
                      Add friend
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Panel>

      {incoming.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Requests for you ({incoming.length})</h2>
          <Panel className="divide-y divide-border p-0">
            {incoming.map((edge) => (
              <div key={edge.friendship.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm font-medium">{edge.profile.username}</span>
                <form action={acceptFriendRequest}>
                  <input type="hidden" name="friendship_id" value={edge.friendship.id} />
                  <Button type="submit" className="text-xs">
                    Accept
                  </Button>
                </form>
                <form action={removeFriendship}>
                  <input type="hidden" name="friendship_id" value={edge.friendship.id} />
                  <Button variant="ghost" type="submit" className="text-xs">
                    Decline
                  </Button>
                </form>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <EmptyState title="No friends yet.">
            Search for someone above. Trading, and everything in the feed, happens between
            friends.
          </EmptyState>
        ) : (
          <Panel className="divide-y divide-border p-0">
            {friends.map((edge) => (
              <div key={edge.friendship.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/u/${edge.profile.username}`}
                  className="flex-1 text-sm font-medium hover:underline"
                >
                  {edge.profile.username}
                </Link>
                <Link href={`/u/${edge.profile.username}`}>
                  <Button variant="secondary" className="text-xs">
                    View trade binder
                  </Button>
                </Link>
                <form action={removeFriendship}>
                  <input type="hidden" name="friendship_id" value={edge.friendship.id} />
                  <Button variant="ghost" type="submit" className="text-xs">
                    Remove
                  </Button>
                </form>
              </div>
            ))}
          </Panel>
        )}
      </section>

      {outgoing.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Sent ({outgoing.length})</h2>
          <Panel className="divide-y divide-border p-0">
            {outgoing.map((edge) => (
              <div key={edge.friendship.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm text-ink-muted">
                  {edge.profile.username} — waiting
                </span>
                <form action={removeFriendship}>
                  <input type="hidden" name="friendship_id" value={edge.friendship.id} />
                  <Button variant="ghost" type="submit" className="text-xs">
                    Withdraw
                  </Button>
                </form>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">What your friends can see</h2>
        <p className="text-xs text-ink-muted">
          Only containers switched on here. Decks, boxes and unsorted cards stay private
          whatever else you do.
        </p>

        {locations.length === 0 ? (
          <EmptyState title="No containers yet.">
            <Link href="/locations" className="text-accent underline">
              Create a binder
            </Link>{" "}
            to have something to offer.
          </EmptyState>
        ) : (
          <Panel className="divide-y divide-border p-0">
            {locations.map((location) => (
              <div key={location.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{location.name}</span>
                  <span className="ml-2 text-xs text-ink-muted">{location.type}</span>
                </div>

                <span
                  className={
                    location.is_tradable ? "text-xs font-medium text-accent" : "text-xs text-ink-muted"
                  }
                >
                  {location.is_tradable ? "Visible to friends" : "Private"}
                </span>

                <form action={setLocationTradable}>
                  <input type="hidden" name="location_id" value={location.id} />
                  <input
                    type="hidden"
                    name="is_tradable"
                    value={location.is_tradable ? "false" : "true"}
                  />
                  <Button variant="secondary" type="submit" className="text-xs">
                    {location.is_tradable ? "Make private" : "Open for trade"}
                  </Button>
                </form>
              </div>
            ))}
          </Panel>
        )}
      </section>
    </div>
  );
}
