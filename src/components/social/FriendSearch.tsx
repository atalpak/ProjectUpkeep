"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { sendFriendRequest } from "@/app/(app)/friends/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { Banner, Button, Card as Panel, Input } from "@/components/ui";
import type { Profile } from "@/lib/social/types";

/**
 * "Find someone", pinned to the top of the Friends page.
 *
 * Everything else on the page — the trades sidebar, the roster below it — is
 * downstream of having added someone at least once, so the search that starts
 * that chain leads the page rather than sitting beneath the things it feeds.
 */
export function FriendSearch({ results, query }: { results: Profile[]; query: string }) {
  const [state, add, adding] = useActionState(sendFriendRequest, EMPTY_SOCIAL_STATE);
  const [search, setSearch] = useState(query);

  return (
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
  );
}
