# Project Upkeep

A Magic: The Gathering collection manager that tracks **where each copy physically
lives** — which binder, which box, which deck — so a digital inventory mirrors
reality.

No marketplace: nothing can be listed, bought or sold here, and a card links out
to TCGplayer when you want one. Prices *are* imported from Scryfall's daily
export and a collection total is shown — carefully, per finish, reporting what it
could not price rather than counting it as zero (`src/lib/collection/pricing.ts`).
What is deliberately absent is a market, not the numbers.

**Status: feature-complete for a single playgroup, and unused by anyone but its
author.** Collection and location management, peer-to-peer trading with
counter-offers and an atomic transfer on acceptance, decks-as-locations, friends
and public profiles are all implemented. Also in: CSV / decklist import, bulk
actions, collection search / filter / sort, the "where is my card" lookup,
checking a pasted list without saving it, Scryfall-sourced reference pricing
(display only), a want list that matches against friends' trade binders, in-app
trade notifications, trade-proposal expiry, and a terms-of-service acceptance
flow.

What to build next is deliberately an open question as of 2026-09-09 — see
[`.claude/ORGANIZATION.md`](.claude/ORGANIZATION.md). The previous roadmap is in
`archive/pre-rebuild-2026-09-09/` and is kept as evidence, not as direction.

---

## Stack

| Concern | Choice |
|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| Database / Auth | Supabase (Postgres + Supabase Auth) |
| Card data | Scryfall bulk export, no API key required |
| Hosting | Vercel free tier |

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

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It is used **only** by
the Scryfall sync job and must never reach the browser.

`SIGNUP_INVITE_CODE` is optional. Set it to require an invite code to create an
account; leave it unset to keep signup open. It is server-only and never
exposed to the browser.

### 3. Apply the schema

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste the files in `supabase/migrations/` into the SQL editor in order.

### 4. Populate the card database

The app searches its own `cards` table, not Scryfall's API, so this step is
required before anything is findable:

```bash
npm run sync:scryfall            # ~500MB download, several minutes
npm run sync:scryfall -- --limit 5000   # quick smoke test instead
```

### 5. Run it

```bash
npm install
npm run dev
```

---

## How it fits together

```
src/
  proxy.ts                  session refresh + private-route gate (Next 16 renamed
                            the `middleware` convention to `proxy`)
  app/
    (app)/                  signed-in pages; the route group gets the nav shell
      collection/           collection view, bulk actions · add/ · import/
      locations/            container management
      decks/                decks as a location type · [id]/ workspace
                            · check/ (reconcile a list without saving) · import/
      find/                 "where is my card?" collection lookup
      dashboard/            collection stats and anything awaiting a decision
      friends/              friends, trade offers and the trade feed
      trades/               settled-trade archive
      wants/                want list + which friends have each card
      notifications/        in-app trade alerts
      settings/             account, appearance, ToS status
      u/[username]/         public profile + tradable binder
    api/
      cards/                search/ · printings/ · [id]/
      collection/           export/ · locate/
      card-actions/         per-card mutations
      notifications/        badge state
    auth/confirm/           email confirmation callback
    login/  signup/
    terms/  privacy/        public legal pages (outside (app), no proxy gate)
  components/
    ui.tsx                  shared primitives; one place to restyle from
    collection/  decks/  settings/  social/  ManaCost.tsx  SetSymbol.tsx  …
  lib/
    cx.ts                   class-name joiner (own module: avoids a cycle)
    env.ts                  environment access with loud failures
    auth/redirect.ts        open-redirect guard for the post-login bounce
    collection/
      queries.ts            read helpers (scope by owner — see constraint 3)
      stacking.ts           >>> the quantity/stacking policy, in one place <<<
      filters.ts            collection search / filter / sort
      locate.ts             "where is my card?" matching
      pricing.ts            Scryfall reference-price formatting (display only)
      deck-view.ts          deck-vs-binder view derivation
      deck-state.ts         reconciling an intended list against what is filed
      deck-stats.ts         per-deck analytics
      availability.ts       what is free to sleeve or trade
      breakdown.ts          collection composition
      entries.ts            the collection_entries view
      export.ts             CSV / decklist generation
      list-check.ts         checking a pasted list without creating a deck
    import/                 parse · resolve · plan · deck-plan · select
                            commit · name-variants · vocabulary
    social/                 queries · counter · trade-status · wants
                            notifications · tos · types
    supabase/               client · server · admin · session · errors
    scryfall.ts             bulk-export types and the mapping into `cards`
    scryfall-stream.ts      streaming reader for the bulk export
    scryfall-upsert.ts      batched upsert with error classification
supabase/
  migrations/               the schema, in order (29 files)
  tests/schema_test.sql     assertions the schema must keep satisfying
scripts/
  sync-scryfall.ts          the scheduled sync job
  verify-migrations.sh      applies migrations to a throwaway Postgres and tests
  *.test.ts                 29 unit-test files over the pure logic in src/lib
```

### Data model in one paragraph

`cards` is Scryfall's data, one row per printing, read-only to users — including
the reference price columns the sync job refreshes. `card_instances` are the
copies you own — each with a condition, finish, language, quantity and a
location. `locations` are your containers, nestable one level deep; a deck is
just a location type, so a card sleeved into one stops counting as available.
`location_id` being null means "unsorted", which is a real and expected state,
not a missing value. On the social side, `friendships` are the trade circle,
`trades` / `trade_items` model a proposal in both directions, `ownership_history`
is the append-only record of every transfer, and `want_list` plus `notifications`
drive want-matching and alerts. The migrations in `supabase/migrations` carry the
reasoning for each decision in their headers.

---

## Two decisions worth knowing about

Phase 0 user validation was skipped, so two schema choices are **educated
guesses**. Both are deliberately cheap to reverse.

**Stacking.** Whether identical copies collapse into one row with a `quantity`
or get a row each is a policy that lives entirely in
`src/lib/collection/stacking.ts`. The database does *not* enforce it — there is
no unique constraint on the stack key. Flip `STACKING_ENABLED` to `false` for
strict one-row-per-physical-card; no migration required.

**Location nesting.** Locations allow one level of nesting, enforced by the
`locations_enforce_nesting` trigger rather than by the table's shape. Dropping
that trigger allows arbitrary depth; ignoring `parent_location_id` in the UI
gives you flat locations. No business logic reads the column.

---

## Ownership and location are deliberately decoupled

The atomic trade transfer is a single statement per card:

```sql
update card_instances
   set owner_user_id = :recipient, location_id = null
 where id = :instance_id;
```

Nothing else on the row needs touching. There is no composite foreign key, no
owner denormalised from `locations`, no generated column tying the two together.
The only rule spanning them — you cannot park a card in someone else's binder —
is a trigger, and nulling the location on transfer satisfies it for free.

That transfer lives in `public.accept_trade(p_trade_id)`, a `SECURITY DEFINER`
function (migrations 9 → 12 → 13). It re-checks that the caller is the
recipient, that the trade is still open and that every item is still owned by
the side that offered it, then moves each card — splitting partial stacks — in
one transaction. Trade completion changes go there, or into a new numbered
migration; never into a loosened RLS policy.

`supabase/tests/schema_test.sql` asserts this shape directly. If that test starts
failing, ownership and location have become coupled and the trade engine just
got harder.

---

## Development

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # unit tests over the pure logic in src/lib/** (mapping,
                     # streaming, stacking, filters, import, pricing, wants, …)
npm run test:db      # apply migrations to a throwaway Postgres and assert on them
```

`npm run test:db` needs a reachable Postgres (`PGHOST`/`PGPORT`/`PGUSER`, or
`PGURL`). It stubs `auth.users` and `auth.uid()` so the schema — including RLS
isolation between two users — can be exercised without booting Supabase. CI runs
it against a `postgres:16` service container.

---

## The Scryfall sync

`scripts/sync-scryfall.ts` pulls Scryfall's `default_cards` bulk export and
upserts every printing into `cards`. It is a scheduled job, not a one-off script:

- **Idempotent** — upserts on the primary key, so re-running is safe.
- **Cheap when nothing changed** — compares Scryfall's own `updated_at` against
  the last successful run and skips the download. `--force` overrides.
- **Streamed** — the export is parsed incrementally and upserted in batches, so
  memory stays flat regardless of file size.
- **Observable** — every run records status, row count and any error in
  `public.scryfall_sync_runs`.

It runs daily via `.github/workflows/scryfall-sync.yml`, which needs
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets.

Scryfall is a free service run on donations. Set `SCRYFALL_CONTACT` so requests
are identifiable, and do not schedule the sync more often than daily — the bulk
data is only regenerated about that often anyway.

---

## Security notes

- Every user-owned table has row-level security, and the queries in
  `src/lib/collection/queries.ts` deliberately do *not* filter by user id — the
  database does it, so there is one place to get it wrong instead of two.
- The `card_instances` update policy pins `owner_user_id` in both `USING` and
  `WITH CHECK`, so a user cannot give a card away (or take one) by editing the
  column directly. The transfer is done by the `public.accept_trade`
  `SECURITY DEFINER` function, not by a loosened policy.
- `trades` and `trade_items` have party-only SELECT policies — a friend who is
  not a party to a trade still cannot read it. `ownership_history` is readable
  by the two parties to a transfer and by their friends (the feed is the point),
  and stays append-only — see below.
- `ownership_history` rejects `UPDATE` and `DELETE` at the trigger level. An
  audit log you can quietly edit is not an audit log.
