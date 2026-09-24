-- ---------------------------------------------------------------------------
-- scryfall_loader: the least-privilege database role the Scryfall loader
-- connects as.
--
-- WHY THIS EXISTS
--
-- The Scryfall sync writes through PostgREST with the service-role key, one
-- upsert request per 500 rows. That is what timed out (BACKLOG item 1), and the
-- fix for the volume is COPY into a staging table plus one set-based upsert,
-- which PostgREST cannot do: it needs a real Postgres connection, through
-- Supabase's session pooler. A connection string is a credential exactly as
-- powerful as the role it names. If that role were `postgres` it would be
-- stronger than the service key, which already bypasses every policy we have.
-- So the loader gets a role of its own that can do what the loader does and
-- nothing else:
--
--   select, insert, update on cards, oracle_cards and scryfall_sync_runs.
--
-- No delete, no truncate, no access to a single user table (profiles,
-- locations, card_instances, trades, ...). If the secret leaks, the damage is
-- bounded to corrupting Scryfall reference data and sync bookkeeping, both of
-- which the next sync rewrites. `cards` and the other two are listed together
-- because the printings load will move to the same connection in a later
-- phase; granting it now means that switch needs no second migration.
--
-- NOLOGIN, AND THE PASSWORD IS NOT HERE
--
-- The role is created NOLOGIN with no password on purpose. A password in a
-- migration is a password in git. The owner turns it on by hand, once, in the
-- SQL editor:
--
--   alter role scryfall_loader login password '<generated, 32+ chars>';
--
-- and stores the connection string as the GitHub secret
-- SCRYFALL_SYNC_DATABASE_URL (session-pooler host, port 5432, user
-- `scryfall_loader.<project-ref>`). Until then the role cannot connect, and the
-- loader step in scryfall-sync.yml skips itself. This migration deliberately
-- never issues `alter role ... login`, so re-running it cannot disable a role
-- the owner has already enabled.
--
-- RLS: A NEW ROLE HAS NO BYPASSRLS
--
-- service_role can write `cards` only because it carries BYPASSRLS. Supabase
-- does not let us create a role with that attribute, so scryfall_loader is
-- subject to row-level security like everyone else, and a table grant alone
-- gets it "permission granted, zero rows". It therefore has explicit policies,
-- one per operation per table, each scoped `to scryfall_loader`. Two things
-- follow from how INSERT ... ON CONFLICT DO UPDATE is checked and are why all
-- three operations are granted and given policies on every table: the upsert
-- needs the INSERT policy for a new row, the UPDATE policy for a conflicting
-- one, and the SELECT policy for both (it has to read the conflicting row).
-- The policies are `using (true)`: the role is already confined by the table
-- grants above, and a per-row predicate here would have nothing to check.
-- Because they name only this role, the existing `cards` policy (select for
-- anon and authenticated) is not widened, and no client gains a write path.
--
-- Nothing else is granted: no sequences (scryfall_sync_runs.id is an identity
-- column, which an INSERT can use without any sequence privilege), and the
-- default privileges in this schema name anon, authenticated and service_role,
-- so a table added later is invisible to this role until someone grants it.
-- TEMPORARY on the database is what lets it build the staging table.
-- ---------------------------------------------------------------------------

do $$
begin
  create role scryfall_loader nologin;
exception when duplicate_object then
  -- Already there (this migration re-run, or the owner created it first). Leave
  -- its attributes alone: it may already be enabled with a password.
  null;
end $$;

comment on role scryfall_loader is
  'Scryfall loader (scripts/sync-oracle-direct.ts). Enabled by the owner by hand: alter role scryfall_loader login password ''...''. Can only select/insert/update cards, oracle_cards, scryfall_sync_runs.';

grant usage on schema public to scryfall_loader;

grant select, insert, update on public.cards, public.oracle_cards, public.scryfall_sync_runs
  to scryfall_loader;

do $$
begin
  execute format('grant temporary on database %I to scryfall_loader', current_database());
end $$;

-- cards ---------------------------------------------------------------------
create policy "cards: loader select" on public.cards
  for select to scryfall_loader using (true);
create policy "cards: loader insert" on public.cards
  for insert to scryfall_loader with check (true);
create policy "cards: loader update" on public.cards
  for update to scryfall_loader using (true) with check (true);

-- oracle_cards --------------------------------------------------------------
create policy "oracle_cards: loader select" on public.oracle_cards
  for select to scryfall_loader using (true);
create policy "oracle_cards: loader insert" on public.oracle_cards
  for insert to scryfall_loader with check (true);
create policy "oracle_cards: loader update" on public.oracle_cards
  for update to scryfall_loader using (true) with check (true);

-- scryfall_sync_runs --------------------------------------------------------
-- Still unreadable and unwritable by every end user: these policies name only
-- the loader, and prices_as_of() remains the one window into the table.
create policy "scryfall_sync_runs: loader select" on public.scryfall_sync_runs
  for select to scryfall_loader using (true);
create policy "scryfall_sync_runs: loader insert" on public.scryfall_sync_runs
  for insert to scryfall_loader with check (true);
create policy "scryfall_sync_runs: loader update" on public.scryfall_sync_runs
  for update to scryfall_loader using (true) with check (true);
