# Project Upkeep

A Magic: The Gathering collection manager that tracks **where each copy physically
lives** — which binder, which box, which deck — so a digital inventory mirrors
reality, and answers *"where is this card, among the people I know?"*

No marketplace: nothing can be listed, bought or sold here, and a card links out
to TCGplayer when you want one. Prices are a display-only Scryfall estimate,
reported per finish, saying what could not be priced rather than counting it as
zero.

**Status: a working product for a single playgroup, used only by its author so
far.** Collection and location management, peer-to-peer trading with
counter-offers and an atomic transfer on acceptance, decks-as-locations, friends
and public profiles, CSV / decklist import, a want list matched against friends'
trade binders, a deck playtester, Scryfall-syntax card search, and an Expo mobile
app with a live card scanner.

> **Where the details live** — this file is only the front door.
> - [`CLAUDE.md`](CLAUDE.md): the directory map, data model, hard constraints and
>   commands. Read it before changing anything.
> - [`.claude/rules/`](.claude/rules): area-specific rules (migrations, app
>   router, data access, testing, mobile).
> - [`.claude/ORGANIZATION.md`](.claude/ORGANIZATION.md): how the agent team works.
> - [`docs/`](docs/README.md): feature guides, handoff logs and briefs.
> - [`archive/`](archive/pre-rebuild-2026-09-09): pre-rebuild planning, kept as
>   evidence rather than direction.

---

## Stack

| Concern | Choice |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 |
| Database / auth | Supabase — Postgres + Supabase Auth, RLS everywhere |
| Card data | Scryfall: bulk export synced into `cards`; live search through Scryfall's API |
| Hosting | Vercel free tier; CI on GitHub Actions |
| Mobile | Expo + React Native, npm workspaces (`apps/mobile`, `packages/*`) |

---

## Getting started

### 1. Create a Supabase project

Free tier is enough. From **Project Settings → API**, copy the project URL, the
anon key, and the service role key.

### 2. Configure the environment

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# and SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It is used only by
scripts outside the Next build (the Scryfall sync and the mobile catalog
publisher) and must never reach the browser.

Optional: `SIGNUP_INVITE_CODE` requires an invite code to sign up (server-only);
`SCRYFALL_SEARCH_CONTACT` is put in the User-Agent Scryfall requires for search
requests; `SCRYFALL_SEARCH_ENABLED=false` switches `/search` back to the older
local search. See `.env.example`.

### 3. Apply the schema

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste the files in `supabase/migrations/` into the SQL editor in order.

### 4. Populate the card database

Name suggestions, collection views and add-to-collection all read the local
`cards` table, so it must be filled first. (Submitted searches on `/search` run
on Scryfall's API instead, so they need no local data.)

```bash
npm run sync:scryfall                   # ~500MB download, several minutes
npm run sync:scryfall -- --limit 5000   # quick smoke test instead
```

### 5. Run it

```bash
npm install
npm run dev
```

---

## Development

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # unit tests over the pure logic in src/lib/**
npm run test:db      # apply migrations to a throwaway Postgres and assert on them
```

Before calling a change done: `npm run lint && npm run typecheck && npm test`.

`npm run test:db` needs a reachable Postgres (`PGHOST`/`PGPORT`/`PGUSER`, or
`PGURL`) and Postgres 15 or newer. It stubs `auth.users` and `auth.uid()` so the
schema — including RLS isolation between two users — can be exercised without
booting Supabase. CI runs it against a `postgres:16` service container.

The full command list, including the mobile workspaces, is in `CLAUDE.md`.

---

## The Scryfall sync

`scripts/sync-scryfall.ts` pulls Scryfall's `default_cards` bulk export and
upserts every printing into `cards`. It is a scheduled job, not a one-off script:

- **Idempotent** — upserts on the primary key, so re-running is safe.
- **Cheap when nothing changed** — compares Scryfall's own `updated_at` against
  the last successful run and skips the download. `--force` overrides.
- **Streamed** — parsed incrementally and upserted in batches, so memory stays
  flat regardless of file size.
- **Observable** — every run records status, row count and any error in
  `public.scryfall_sync_runs`.

It runs daily via `.github/workflows/scryfall-sync.yml`, which needs
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets.
The same workflow refreshes the Oracle-card table and publishes the mobile
catalog.

Scryfall is a free service run on donations. Keep the sync at daily or slower —
the bulk data is only regenerated about that often — and keep search traffic
inside the shared limiter (`claim_scryfall_slot`, migration 48).

---

## Security in one paragraph

Every user-owned table has row-level security, but RLS is the floor, not the
whole filter: since a friend's tradable binder is readable by design, queries
that ask "what do *I* own" must also filter on the owner explicitly, and removing
one of those filters is a cross-user data leak. Nothing under `src/`, `apps/` or
`packages/` may hold a database credential stronger than the signed-in user's.
Trade transfers happen inside the `public.accept_trade` `SECURITY DEFINER`
function, never through a loosened policy, and `ownership_history` rejects
`UPDATE` and `DELETE` at the trigger level. The reasoning and the full list of
hard constraints are in `CLAUDE.md`.
