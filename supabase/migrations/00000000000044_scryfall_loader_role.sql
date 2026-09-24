-- ---------------------------------------------------------------------------
-- scryfall_loader: the least-privilege database role the oracle loader
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
--   oracle_cards:        select, insert, update.
--   scryfall_sync_runs:  select, insert and update, but only on rows whose
--                        bulk_type is 'oracle_cards', and only the columns a
--                        run record needs.
--
-- No delete, no truncate, NO ACCESS TO `cards`, and no access to a single user
-- table (profiles, locations, card_instances, trades, ...).
--
-- `cards` is deliberately absent. The printings load still goes through
-- PostgREST and never touches this role; when it moves to COPY, that phase's
-- own migration adds the `cards` grants and policies, reviewed with that change
-- in front of it. Granting them speculatively now would widen a leaked secret
-- for a feature that does not exist yet.
--
-- WHAT A LEAKED CONNECTION STRING CAN DO
--
-- Corrupt or empty-then-refill public.oracle_cards (update, but not delete or
-- truncate; the next load rewrites it, because it is keyed and fingerprinted
-- and a bad row is simply "changed"), and add or rewrite oracle_cards rows in
-- the run history. It CANNOT: read or write `cards` or any user data; forge a
-- default_cards run (the policies below pin bulk_type, and prices_as_of()
-- filters on it anyway, migration 45); flip catalog_needs_publish or
-- catalog_published_at, which would mislead the printings sync and the mobile
-- catalog publish (column grants below); or delete history. It can still
-- connect, run cheap queries and hold sessions open, as any login can.
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
-- service_role can write tables only because it carries BYPASSRLS. Supabase
-- does not let us create a role with that attribute, so scryfall_loader is
-- subject to row-level security like everyone else, and a table grant alone
-- gets it "permission granted, zero rows". It therefore has explicit policies,
-- scoped `to scryfall_loader`. INSERT ... ON CONFLICT DO UPDATE needs the
-- select, insert and update policies together (it reads the conflicting row),
-- which is why oracle_cards has all three. The oracle_cards policies are
-- `using (true)`: the table grants already confine the role. The
-- scryfall_sync_runs policies are the real restriction there, pinning
-- bulk_type in both USING and WITH CHECK so a row cannot be rewritten into
-- another type, either.
--
-- Nothing else is granted. No sequences: scryfall_sync_runs.id is an identity
-- column, which an INSERT can use with no sequence privilege. The default
-- privileges in this schema name anon, authenticated and service_role, so a
-- table added later is invisible to this role until someone grants it.
--
-- service_role, incidentally, has no write access to oracle_cards either
-- (migration 43 revokes it on purpose): the printings script
-- (scripts/sync-scryfall.ts) never needs it, and the only writer of
-- oracle_cards is this role.
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
  'Scryfall oracle loader (scripts/sync-oracle-direct.ts). Enabled by the owner by hand: alter role scryfall_loader login password ''...''. Can only touch oracle_cards and its own oracle_cards rows in scryfall_sync_runs.';

grant usage on schema public to scryfall_loader;

-- oracle_cards --------------------------------------------------------------
grant select, insert, update on public.oracle_cards to scryfall_loader;

create policy "oracle_cards: loader select" on public.oracle_cards
  for select to scryfall_loader using (true);
create policy "oracle_cards: loader insert" on public.oracle_cards
  for insert to scryfall_loader with check (true);
create policy "oracle_cards: loader update" on public.oracle_cards
  for update to scryfall_loader using (true) with check (true);

-- scryfall_sync_runs --------------------------------------------------------
-- Column-level, so the loader cannot touch the catalog bookkeeping from
-- migration 42 (catalog_needs_publish, catalog_published_at), and cannot
-- choose an id. It may change a row's status and outcome, not its bulk_type.
grant select on public.scryfall_sync_runs to scryfall_loader;
grant insert (bulk_type, bulk_updated_at, status, cards_upserted, error_message,
              started_at, finished_at)
  on public.scryfall_sync_runs to scryfall_loader;
grant update (status, cards_upserted, error_message, finished_at)
  on public.scryfall_sync_runs to scryfall_loader;

-- Still unreadable and unwritable by every end user: these policies name only
-- the loader, and prices_as_of() remains the one window into the table.
create policy "scryfall_sync_runs: loader select" on public.scryfall_sync_runs
  for select to scryfall_loader using (bulk_type = 'oracle_cards');
create policy "scryfall_sync_runs: loader insert" on public.scryfall_sync_runs
  for insert to scryfall_loader with check (bulk_type = 'oracle_cards');
create policy "scryfall_sync_runs: loader update" on public.scryfall_sync_runs
  for update to scryfall_loader
  using (bulk_type = 'oracle_cards') with check (bulk_type = 'oracle_cards');

-- The loader builds a session-local staging table. Postgres grants TEMPORARY to
-- PUBLIC by default, so this is normally redundant; it is stated so the loader
-- does not silently depend on that default staying in place.
do $$
begin
  execute format('grant temporary on database %I to scryfall_loader', current_database());
end $$;
