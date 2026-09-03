# Project Upkeep

A Magic: The Gathering collection manager that tracks **where each copy physically
lives** — which binder, which box, which deck — so a digital inventory mirrors
reality.

No pricing, no marketplace, no valuation. That is a deliberate scope decision,
not a gap; see [`docs/CHARTER.md`](docs/CHARTER.md).

**Status: Phase 1 (core build).** Collection and location management are
implemented. Trading is Phase 2 — the tables exist for forward-compatibility but
nothing reads or writes them yet.

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
  app/
    (app)/                  signed-in pages; the route group gets the nav shell
      collection/           collection view, add-card flow, instance actions
      locations/            container management
    api/cards/              name autocomplete + printing lookup
    auth/                   sign in / sign up / sign out actions
  components/               UI, including the add-card and collection widgets
  lib/
    auth/redirect.ts        open-redirect guard for the post-login bounce
    collection/queries.ts   read helpers (RLS does the ownership filtering)
    collection/stacking.ts  >>> the quantity/stacking policy, in one place <<<
    scryfall.ts             bulk-export types and the mapping into `cards`
    scryfall-stream.ts      streaming reader for the bulk export
    supabase/               browser, server, admin and session clients
  proxy.ts                  refreshes the session, gates private routes
supabase/
  migrations/               the schema, in order
  tests/schema_test.sql     assertions the schema must keep satisfying
scripts/
  sync-scryfall.ts          the scheduled sync job
  verify-migrations.sh      applies migrations to a throwaway Postgres and tests
```

### Data model in one paragraph

`cards` is Scryfall's data, one row per printing, read-only to users.
`card_instances` are the copies you own — each with a condition, finish,
language, quantity and a location. `locations` are your containers, nestable one
level deep. `location_id` being null means "unsorted", which is a real and
expected state, not a missing value. Full detail in
[`docs/data-model-v1.md`](docs/data-model-v1.md).

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

Phase 2's atomic trade transfer needs to be a single statement:

```sql
update card_instances
   set owner_user_id = :recipient, location_id = null
 where id = :instance_id;
```

Nothing else on the row needs touching. There is no composite foreign key, no
owner denormalised from `locations`, no generated column tying the two together.
The only rule spanning them — you cannot park a card in someone else's binder —
is a trigger, and nulling the location on transfer satisfies it for free.

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
npm test             # unit tests (mapping, streaming, stacking, redirect guard)
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
  column directly. Phase 2's transfer should be a `SECURITY DEFINER` function
  rather than a loosened policy.
- `trades`, `trade_items` and `ownership_history` have RLS enabled with **no
  policies** — deny-all until Phase 2 opens them deliberately.
- `ownership_history` rejects `UPDATE` and `DELETE` at the trigger level. An
  audit log you can quietly edit is not an audit log.
