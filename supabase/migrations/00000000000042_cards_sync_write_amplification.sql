-- ---------------------------------------------------------------------------
-- Make the daily Scryfall sync cheap to write: three dead indexes out, and a
-- fingerprint column so unchanged rows can be left alone.
--
-- WHY THIS EXISTS
--
-- The sync upserted all ~118,000 printings every day and stamped
-- last_synced_at and prices_updated_at on every one, so every row was
-- rewritten whether or not Scryfall had changed anything. Against the live
-- table that was ~3.0M updates of which only ~0.89M were HOT (heap-only, no
-- index maintenance), and public.cards carried 11 indexes. Each non-HOT
-- update rewrites an entry in every one of them, including the three large
-- trigram GIN indexes; that write amplification is what pushed the batches
-- into the statement timeout (see src/lib/scryfall-upsert.ts, and BACKLOG
-- item 1). Two changes fix it, and this migration carries the schema half of
-- both.
--
-- 1. Drop indexes nothing reads.
--
--    cards_set_code_number_idx (migration 24) is byte-for-byte the same index
--    as cards_set_collector_idx (migration 3), on (set_code,
--    collector_number). Migration 24 added it with `if not exists` under a
--    different name, so it did not notice the twin. Zero scans. The original
--    stays.
--
--    cards_name_lower_idx (migration 3) indexes lower(name). Nothing filters
--    on lower(name): exact lookups use `.eq("name", ...)` / `.in("name", ...)`
--    and are served by cards_name_idx; substring and prefix matches use
--    ilike, which the trigram index answers and which a lower() btree cannot
--    serve anyway; search_card_names uses lower(name) only as a sort key over
--    rows already selected. Zero scans. (cards_flavor_name_lower_idx, which
--    migration 26 described as mirroring it, is a separate index and is left
--    alone.)
--
--    cards_price_usd_idx (migration 11) is a btree on price_usd, and the
--    only index that made an ordinary price change a non-HOT update. Nothing
--    sorts or filters cards by price_usd: the one ORDER BY on a price is the
--    dashboard peek, which orders collection_entries rows already narrowed to
--    one owner, and the collection's price sort happens in the client over
--    the rows it has loaded. Two scans in its lifetime. With it gone, a
--    price-only update can be HOT.
--
--    The three trigram GIN indexes (name, type_line, oracle_text) are what
--    card search runs on and are deliberately untouched.
--
-- 2. content_hash, so the sync can skip rows that did not change.
--
--    The sync now reads (scryfall_id, content_hash) up front, hashes each
--    incoming row, and writes only rows whose hash differs. The value is two
--    fingerprints joined by a dot -- "<everything except prices>.<prices>" --
--    so the sync can tell a price-only change (advance prices_updated_at)
--    from a metadata-only change (leave it alone). The format is owned by
--    src/lib/scryfall-diff.ts; the database treats it as an opaque string.
--
--    Nullable, no default, no index: it is only ever read in bulk, in
--    primary-key order. Null means "never fingerprinted", which the sync
--    treats as changed, so the first run after this migration rewrites every
--    row once and fills the column in. An index here would put back the very
--    write cost this migration removes.
--
-- 3. Two things the sync's new behaviour needs from scryfall_sync_runs.
--
--    "Prices as of". The dashboard used to show the newest per-row
--    prices_updated_at, which was really "when the last sync ran". Now that
--    the column moves only when a price does, that no longer says how fresh
--    prices are. The honest answer is when the last successful sync finished,
--    and that lives in scryfall_sync_runs, which end users deliberately
--    cannot read (RLS on, no policies -- migration 3). Rather than open the
--    table, prices_as_of() returns exactly one value from it: finished_at of
--    the latest *succeeded* run (skipped runs do not count -- a skip confirms
--    the export is unchanged, not that we refreshed anything). SECURITY
--    DEFINER because the caller cannot read the table; search_path is pinned
--    to empty and every name is schema-qualified, so a caller cannot shadow
--    one; executable by signed-in users only, never anon.
--
--    "Catalog published". The mobile catalog is rebuilt only when a sync
--    changed something the catalog contains, and the sync used to decide that
--    once, in memory: if the publish step then failed, the next run saw no
--    changes and never retried. So each run now records whether it left the
--    catalog needing a publish (catalog_needs_publish), and the publish step
--    stamps catalog_published_at only after the upload succeeds. The next sync
--    republishes while any succeeded run is still needing-and-unpublished.
--    Both are written by service-role scripts only, so no policy changes.
--
-- ORDER OF OPERATIONS: apply this migration BEFORE the sync code that reads
-- content_hash runs, and do not apply it while a sync is running: DROP INDEX
-- takes a brief ACCESS EXCLUSIVE lock on cards, which queues behind the sync's
-- open upserts and blocks every reader of cards (search, the app) behind it
-- until they finish. Against a database without the column the sync stops at
-- its first read with an explicit message and writes nothing.
-- ---------------------------------------------------------------------------

drop index if exists public.cards_set_code_number_idx;
drop index if exists public.cards_name_lower_idx;
drop index if exists public.cards_price_usd_idx;

alter table public.cards
  add column if not exists content_hash text;

comment on column public.cards.content_hash is
  'Sync fingerprint: "<non-price fields hash>.<price fields hash>". Written only by scripts/sync-scryfall.ts; null means never fingerprinted, so the next sync rewrites the row.';

-- prices_updated_at used to be stamped on every row every day, so it meant
-- "when the last sync ran". The sync now advances it only when a card's price
-- actually changed (and leaves it alone on a metadata-only write), so the old
-- meaning is gone; say the new one where the next reader will look.
comment on column public.cards.prices_updated_at is
  'When this card''s price last changed, as seen by a sync. Not "when prices were last refreshed": unchanged rows are not rewritten. Null means never priced.';

alter table public.scryfall_sync_runs
  add column if not exists catalog_needs_publish boolean not null default false,
  add column if not exists catalog_published_at  timestamptz;

comment on column public.scryfall_sync_runs.catalog_needs_publish is
  'True when this run left the mobile catalog needing a rebuild: it wrote catalog-visible rows, followed a run that died after writing, or was forced. A skipped run sets it only when it republished for the middle reason.';
comment on column public.scryfall_sync_runs.catalog_published_at is
  'Set by scripts/publish-catalog.ts after a catalog upload succeeds, on every succeeded or skipped run that needed one. Null on a needing run means the publish has not happened yet.';

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
     and r.finished_at is not null
   order by r.finished_at desc
   limit 1;
$$;

comment on function public.prices_as_of() is
  'When the last successful Scryfall sync finished. The only thing signed-in users may read from scryfall_sync_runs.';

-- Functions are executable by PUBLIC by default, and Supabase also grants
-- them to anon directly; take both away, then give back exactly one role.
revoke all on function public.prices_as_of() from public, anon;
grant execute on function public.prices_as_of() to authenticated;
