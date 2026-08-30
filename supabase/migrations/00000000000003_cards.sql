-- ---------------------------------------------------------------------------
-- cards
--
-- One row per *printing*, mirrored from Scryfall's bulk `default_cards` export.
-- Never user-editable: RLS grants SELECT to everyone and INSERT/UPDATE/DELETE
-- to nobody. The sync job writes with the service role key, which bypasses RLS.
--
-- Columns beyond the data-model sketch (set_name, released_at, rarity,
-- type_line, image_uri_small, digital, oracle_id) are all present in the bulk
-- export at no extra cost and are what the printing picker actually needs to be
-- legible — you cannot tell two "Lightning Bolt" rows apart from set_code and
-- collector_number alone.
-- ---------------------------------------------------------------------------

create table public.cards (
  -- Scryfall's own id, used directly as our PK. No surrogate key: it makes the
  -- sync job an idempotent upsert and makes rows traceable back to source.
  scryfall_id        uuid primary key,

  -- Shared by every printing of the same card. Phase 2+ ("do you have any
  -- printing of X?") wants this; the printing picker groups on it too.
  oracle_id          uuid,

  name               text not null,
  set_code           text not null,
  set_name           text,
  collector_number   text not null,
  rarity             text,
  type_line          text,
  released_at        date,

  -- Served from Scryfall's CDN, not re-hosted. `image_uri` is the normal-size
  -- face; `image_uri_small` is for list rows where the large one is wasteful.
  image_uri          text,
  image_uri_small    text,
  scryfall_uri       text,

  -- e.g. {nonfoil,foil,etched}. Constrains what finishes a card_instance of
  -- this printing is allowed to claim (enforced in the app, not the DB — see
  -- the note on card_instances.finish).
  available_finishes text[] not null default '{}',

  -- Language of this printing, per Scryfall. Note this is the *printing's*
  -- language; what the user physically owns lives on card_instances.language.
  lang               text not null default 'en',

  -- Arena/MTGO-only printings. Kept (they are real printings) but filtered out
  -- of search by default, since this app tracks physical cardboard.
  digital            boolean not null default false,

  last_synced_at     timestamptz not null default now()
);

-- Substring search: "bolt" -> "Lightning Bolt".
create index cards_name_trgm_idx on public.cards using gin (name extensions.gin_trgm_ops);
-- Prefix search and the group-by in search_card_names().
create index cards_name_lower_idx on public.cards (lower(name));
create index cards_oracle_id_idx on public.cards (oracle_id);
create index cards_set_collector_idx on public.cards (set_code, collector_number);

-- ---------------------------------------------------------------------------
-- search_card_names
--
-- Autocomplete step 1: the user types a fragment and picks a card *name*.
-- Returning one row per name (rather than per printing) keeps the dropdown
-- short — "Lightning Bolt" has dozens of printings and they are all the same
-- suggestion as far as the person typing is concerned.
--
-- Ordering puts prefix matches first, then shorter names, so typing "bolt"
-- surfaces "Bolt" and "Lightning Bolt" above "Thunderbolt Dragon".
-- ---------------------------------------------------------------------------
create or replace function public.search_card_names(
  q text,
  result_limit int default 20,
  include_digital boolean default false
)
returns table (
  name              text,
  printing_count    bigint,
  sample_image_uri  text,
  sample_card_id    uuid
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.name,
    count(*) as printing_count,
    (array_agg(c.image_uri_small order by c.released_at desc nulls last))[1] as sample_image_uri,
    (array_agg(c.scryfall_id  order by c.released_at desc nulls last))[1] as sample_card_id
  from public.cards c
  where c.name ilike '%' || q || '%'
    and (include_digital or not c.digital)
  group by c.name
  order by
    (lower(c.name) like lower(q) || '%') desc,
    char_length(c.name) asc,
    c.name asc
  limit least(greatest(result_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- RLS: readable by anyone, writable by no one (service role bypasses this).
-- ---------------------------------------------------------------------------
alter table public.cards enable row level security;

create policy "cards: readable by everyone"
  on public.cards for select
  to anon, authenticated
  using (true);

grant execute on function public.search_card_names(text, int, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- scryfall_sync_runs
--
-- Bookkeeping for the sync job so it is an observable, repeatable job rather
-- than a script someone runs and hopes about. `bulk_updated_at` is Scryfall's
-- own timestamp for the export, which lets a scheduled run no-op cheaply when
-- the upstream data has not changed since the last success.
-- ---------------------------------------------------------------------------
create table public.scryfall_sync_runs (
  id               bigint generated always as identity primary key,
  bulk_type        text not null,
  bulk_updated_at  timestamptz,
  status           text not null default 'running'
                     check (status in ('running', 'succeeded', 'failed', 'skipped')),
  cards_upserted   integer not null default 0,
  error_message    text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index scryfall_sync_runs_recent_idx
  on public.scryfall_sync_runs (bulk_type, started_at desc);

-- Written only by the sync job (service role). No policies: end users have no
-- business reading or writing sync bookkeeping.
alter table public.scryfall_sync_runs enable row level security;
