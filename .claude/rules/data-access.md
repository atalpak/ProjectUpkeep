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
RLS-bypassing client in the web app, and adding one is not on the table.** The
only thing in this codebase that bypasses RLS is the Scryfall sync job, which
builds its own service-role client inline in `scripts/sync-scryfall.ts` — outside
the Next build, so it cannot reach a browser bundle — and writes only to `cards`
and `scryfall_sync_runs`.

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

If a query returns rows from someone it should not reach at all, that *is* a
policy bug — fix the policy in a new migration. If it returns a friend's rows
where it should have returned only yours, the owner filter is missing.

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
read only in `scripts/sync-scryfall.ts`, via that script's own local `requireEnv`.
