-- ---------------------------------------------------------------------------
-- prices_as_of() answers for the printings sync only.
--
-- WHY THIS EXISTS
--
-- Migration 42 defined prices_as_of() as "finished_at of the newest succeeded
-- run in scryfall_sync_runs". That was exactly right while every run in the
-- table was a default_cards run. Migration 43/44 add a second writer to the
-- same table: the oracle loader records its own runs under bulk_type
-- 'oracle_cards'. Left as it was, the dashboard's "prices as of" date would
-- follow whichever loader finished last, so a night when the printings sync
-- failed but the oracle load succeeded would show today's date on prices that
-- were not refreshed. The rules text of a card being current says nothing
-- about its price being current.
--
-- The fix is the filter the function always implicitly needed:
-- bulk_type = 'default_cards', the type that carries prices. Everything else
-- about the function is exactly as migration 42 left it (SECURITY DEFINER,
-- empty search_path with schema-qualified names, executable by signed-in users
-- only) and is restated below because `create or replace` resets nothing but
-- the body while a `drop`/re-create would reset the grants.
--
-- The other readers of scryfall_sync_runs were audited for the same mistake:
-- every query in scripts/sync-scryfall.ts that looks at history filters on
-- bulk_type; scripts/publish-catalog.ts stamps only rows with
-- catalog_needs_publish = true (which oracle runs never set, and the loader's
-- policies in migration 44 forbid it from setting) and now also excludes
-- oracle_cards by name; the oracle loader filters on its own bulk_type.
-- ---------------------------------------------------------------------------

create or replace function public.prices_as_of()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select r.finished_at
    from public.scryfall_sync_runs r
   where r.status = 'succeeded'
     and r.bulk_type = 'default_cards'
     and r.finished_at is not null
   order by r.finished_at desc
   limit 1;
$$;

comment on function public.prices_as_of() is
  'When the last successful printings (default_cards) sync finished. Other bulk types, such as the oracle_cards load, do not refresh prices and never count. The only thing signed-in users may read from scryfall_sync_runs.';

revoke all on function public.prices_as_of() from public, anon;
grant execute on function public.prices_as_of() to authenticated;
