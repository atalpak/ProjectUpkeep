---
paths:
  - "src/lib/supabase/**"
  - "src/lib/collection/queries.ts"
  - "src/lib/social/queries.ts"
  - "src/lib/env.ts"
description: Which Supabase client to use, and why own-collection queries must filter by owner.
---

# Data access and RLS

## Pick the right client

| File | Runs as | Use it in |
|---|---|---|
| `supabase/client.ts` | signed-in user (anon key) | Client Components |
| `supabase/server.ts` | signed-in user (anon key + cookie) | Server Components, Route Handlers, Server Actions |
| `supabase/session.ts` | signed-in user | `src/proxy.ts` only — refreshes the cookie |

Every client available under `src/` runs as the signed-in user. **There is no
RLS-bypassing client in the web app, and adding one is not on the table.** Two
things in this codebase bypass RLS, both under the repo-root `scripts/`
directory (outside the Next build, so neither can reach a browser bundle),
each building its own service-role client inline rather than importing a
shared admin client:

- `scripts/sync-scryfall.ts`, the Scryfall sync job, writes only to `cards`
  and `scryfall_sync_runs`.
- `scripts/publish-catalog.ts` (mobile-app initiative phase 5) uploads a
  built mobile catalog bundle to a public Supabase Storage bucket.
  `scripts/create-catalog-bucket.ts`, the one-off script that creates that
  bucket, is the same pattern for the same reason — see its own header for
  why it is a script and not a migration. `scripts/export-catalog.ts`, which
  reads the input for the catalog build, is deliberately **not** on this
  list: `cards` already grants `select` to `anon` (migration 3), so it reads
  with `NEXT_PUBLIC_SUPABASE_ANON_KEY`, not the service-role key.

A `supabase/admin.ts` used to sit in this table, described as protected by a
`server-only` import. It had no importers and could not have had any: the
`server-only` package throws unconditionally outside a React Server Component,
so the `tsx` sync script would have died on import. It was deleted on 2026-09-09.

## Own-collection queries must filter by user — RLS alone is not enough

`src/lib/collection/queries.ts` appends `.eq('owner_user_id', …)` to every query
that answers "what do *I* own", and that is **required**, not belt-and-braces.

Until migration 9 these queries relied on RLS alone, and that was correct at the
time. Migration 9 added a policy (lines 167–179) that lets you read a friend's
`card_instances` when they sit in a location marked `is_tradable` — deliberately,
so their public binder can be displayed. From that moment an unscoped `select`
over `locations` or `card_instances` returns a friend's trade binder mixed in with
your own, which would corrupt collection counts, deck availability and stats.

So: **removing one of those filters is a cross-user data leak, not a cleanup.**
The rule is that RLS is the floor — it stops you reading what you have no right
to — and the explicit owner filter is what makes a query mean "mine". A query
that intentionally reads across people (the public binder, want matching) carries
a comment saying so.

Migration 35 added a second policy in this shape: a friend's deck marked
`is_public` makes its `deck_cards` rows readable too (decklist only — the same
migration leaves `card_instances` untouched, deliberately, since sharing a
decklist is not sharing the physical cards). `getDecks`,
`getCrossDeckAvailableCount` and `getDeckList` in
`src/lib/collection/queries.ts` used to read `deck_cards` unscoped, trusting
that no cross-user row could ever appear; that stopped being true, so they now
join through `locations` and filter on its `user_id` the same way the
`card_instances` queries filter on `owner_user_id`.

If a query returns rows from someone it should not reach at all, that *is* a
policy bug — fix the policy in a new migration. If it returns a friend's rows
where it should have returned only yours, the owner filter is missing.

`public.apply_stack_addition` (migration 36) is the one write path so far that
is `security invoker` rather than a plain client query, and it is worth
naming here because the usual "RLS is the floor, the app filter is what makes
it mean *mine*" story gets an extra wrinkle for it: the function's own
`owner_user_id = auth.uid()` predicate on its merge lookup turned out, in
testing, to be redundant with RLS's `card_instances: update own` policy for
that exact query shape (`select ... for update` inside a function that then
performs the matching `update` — Postgres requires a locking `SELECT` to also
satisfy the table's UPDATE policy, not just its SELECT policy, and that policy
has no friends'-tradable carve-out the way the SELECT policy does). The
predicate stays anyway, written explicitly, for the same reason every other
query in this document is scoped explicitly rather than trusting RLS alone —
and it is independently load-bearing the moment RLS's UPDATE policy is ever
widened for an unrelated reason, which is exactly the kind of change hard
constraint 3 exists to catch. Do not read the redundancy today as permission
to drop the predicate.

## Error classification

`supabase/errors.ts` exists because "this column does not exist yet" arrives
under two different codes depending on the path: `42703` from Postgres for a
raw `SELECT`, `PGRST204` from PostgREST for insert/update, which validates
against its own schema cache. Same cause, different code. Use the helper rather
than matching codes inline.

## Environment variables

`src/lib/env.ts` fails loudly and by name when a variable is missing — a missing
key should stop the process with a sentence saying what to set, not surface
later as an opaque 401.

**The `NEXT_PUBLIC_*` reads must stay literal member expressions.** A dynamic
`process.env[name]` read is invisible to Next's inliner, so it yields `undefined`
in production and crashes the Edge proxy on every request. CI greps the build
output to catch this; see `.claude/rules/testing.md`.

There is no `required(name)` helper any more — it was removed on 2026-09-09 along
with its only caller, so `src/` now contains no dynamic env access at all. Do not
reintroduce one: `requiredValue(value, label)` takes an already-resolved value, so
the lookup stays at the call site where the bundler can see it.

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must never reach the browser. It is
read in exactly two places, `scripts/sync-scryfall.ts` and
`scripts/publish-catalog.ts`/`scripts/create-catalog-bucket.ts` (added for the
mobile catalog pipeline, 2026-09), both via the same local `requireEnv`
pattern — see the client table above for why both are safe.
