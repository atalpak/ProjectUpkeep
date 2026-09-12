"use client";

import Link from "next/link";
import { useState } from "react";

import { acceptFriendRequest, removeFriendship, setLocationTradable } from "@/app/(app)/friends/actions";
import { Button, Card as Panel, EmptyState } from "@/components/ui";
import type { FriendEdge } from "@/lib/social/types";
import type { Location } from "@/lib/types";

/**
 * Friends, requests, and the switch that makes a binder tradable.
 *
 * The tradable switch lives here rather than on the locations page because it
 * is the only control in the app that shows anything to another person, and
 * that is easier to reason about when it sits next to the list of who those
 * people are. Search moved out to `FriendSearch`, which leads the page — this
 * is what fills the rest of it once someone has been added.
 */
export function FriendsManager({
  friends,
  incoming,
  outgoing,
  locations,
}: {
  friends: FriendEdge[];
  incoming: FriendEdge[];
  outgoing: FriendEdge[];
  locations: Array<Location & { is_tradable?: boolean }>;
}) {
  // The default view answers "what would a friend actually see" — which is
  // only the tradable ones. Private locations are one click away rather than
  // gone, but showing every deck and box up front is what made this section
  // long enough to bury the roster below it.
  const [showPrivate, setShowPrivate] = useState(false);
  const tradable = locations.filter((l) => l.is_tradable);
  const privateLocations = locations.filter((l) => !l.is_tradable);

  return (
    <div className="space-y-6">
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
          <>
            {tradable.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing is open for trade yet, so friends see nothing of yours.
              </p>
            ) : (
              <Panel className="divide-y divide-border p-0">
                {tradable.map((location) => (
                  <LocationRow key={location.id} location={location} />
                ))}
              </Panel>
            )}

            {privateLocations.length > 0 ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowPrivate((s) => !s)}
                  className="text-xs text-accent underline"
                >
                  {showPrivate
                    ? "Hide private locations"
                    : `Show private locations too (${privateLocations.length})`}
                </button>

                {showPrivate ? (
                  <Panel className="divide-y divide-border p-0">
                    {privateLocations.map((location) => (
                      <LocationRow key={location.id} location={location} />
                    ))}
                  </Panel>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function LocationRow({ location }: { location: Location & { is_tradable?: boolean } }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
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
        <input type="hidden" name="is_tradable" value={location.is_tradable ? "false" : "true"} />
        <Button variant="secondary" type="submit" className="text-xs">
          {location.is_tradable ? "Make private" : "Open for trade"}
        </Button>
      </form>
    </div>
  );
}
