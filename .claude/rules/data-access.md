---
paths:
  - "src/lib/supabase/**"
  - "src/lib/collection/queries.ts"
  - "src/lib/social/queries.ts"
  - "src/lib/env.ts"
description: Which Supabase client to use, and why queries do not filter by user.
---

# Data access and RLS

## Pick the right client

| File | Runs as | Use it in |
|---|---|---|
| `supabase/client.ts` | signed-in user (anon key) | Client Components |
| `supabase/server.ts` | signed-in user (anon key + cookie) | Server Components, Route Handlers, Server Actions |
| `supabase/session.ts` | signed-in user | `src/proxy.ts` only — refreshes the cookie |
| `supabase/admin.ts` | **service role — BYPASSES RLS** | `scripts/sync-scryfall.ts` only |

`admin.ts` carries a `server-only` import so importing it into a Client
Component is a build error. Keep it that way. The only thing in this codebase
that bypasses RLS is the Scryfall sync job, which runs outside the web app
entirely and writes only to `cards` and `scryfall_sync_runs`.

## Queries deliberately do not filter by user

`src/lib/collection/queries.ts` does **not** append `.eq('owner_user_id', …)`.
This is intentional: row-level security does the filtering, so there is one
place to get ownership wrong instead of two. Adding a "belt and braces" filter
is not defensive — it creates a second source of truth that will drift.

If a query returns rows it should not, the bug is in a policy. Fix the policy in
a new migration.

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

**The `NEXT_PUBLIC_*` reads must stay literal member expressions.** Routing them
through the dynamic `required(name)` helper yields `undefined` in production and
crashes the Edge proxy on every request. CI greps the build output to catch this;
see `.claude/rules/testing.md`.

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must never reach the browser.
