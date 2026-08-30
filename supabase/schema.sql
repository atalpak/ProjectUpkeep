-- ===========================================================================
-- MTGManager — complete schema, Phase 1
--
-- HOW TO USE THIS FILE
--   1. Open your Supabase project.
--   2. Click "SQL Editor" in the left sidebar.
--   3. Click "New query".
--   4. Paste this entire file.
--   5. Click "Run".
--
-- It should finish in a second or two with "Success. No rows returned".
-- That is the expected result — this file creates tables, it does not read any.
--
-- Running it twice will fail with "already exists" errors. That is harmless,
-- it just means the schema is already there.
--
-- This is every file in supabase/migrations/ concatenated in order. If you are
-- using the Supabase CLI instead, use `supabase db push` and ignore this file.
-- ===========================================================================


-- ===========================================================================
-- FROM: supabase/migrations/00000000000001_extensions_and_helpers.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- Extensions and shared helpers.
-- ---------------------------------------------------------------------------

-- gen_random_uuid()
create extension if not exists "pgcrypto" with schema extensions;

-- Trigram indexes, for card-name search that tolerates typing "bolt" and
-- matching "Lightning Bolt".
create extension if not exists "pg_trgm" with schema extensions;

-- ---------------------------------------------------------------------------
-- Keeps an `updated_at` column honest. Attached per-table below.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ===========================================================================
-- FROM: supabase/migrations/00000000000002_profiles.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- profiles
--
-- The data model sketches a `users` table with id/username/email/created_at.
-- Supabase Auth already owns identity (auth.users holds the id, email, and
-- created_at), and the brief says not to hand-roll auth tables. So the only
-- thing left for us to store is the app-level bit Auth does not have: a
-- username. `profiles` is that table, keyed 1:1 to auth.users.
--
-- Every user-owned table below therefore points its FK at auth.users(id), not
-- at profiles — profiles is decoration on identity, not identity itself.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 3 and 32),
  -- Letters, numbers, underscore, hyphen. Deliberately narrow: Phase 2 trading
  -- will let people find each other by username, and ambiguous lookalikes are a
  -- social-engineering vector in a trading app.
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_-]+$')
);

create unique index profiles_username_key on public.profiles (lower(username));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile whenever Supabase Auth creates a user, so there is
-- never a signed-in user without a profile row.
--
-- The signup form passes a username through `options.data`, which lands in
-- raw_user_meta_data. If it is missing or already taken we fall back to a
-- generated name rather than failing the signup — a user with an ugly username
-- can rename themselves; a user whose signup 500s cannot.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  candidate text;
begin
  requested := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if requested is null or requested !~ '^[A-Za-z0-9_-]{3,32}$' then
    requested := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  candidate := requested;

  -- Suffix on collision. Bounded loop; after 25 tries fall back to the uuid.
  for i in 1..25 loop
    exit when not exists (
      select 1 from public.profiles p where lower(p.username) = lower(candidate)
    );
    candidate := substr(requested, 1, 27) || '_' || i::text;
  end loop;

  if exists (select 1 from public.profiles p where lower(p.username) = lower(candidate)) then
    candidate := 'player_' || replace(new.id::text, '-', '');
  end if;

  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Own-profile only for now. Phase 2 (trading) will need users to look each
-- other up by username; widen with an additional SELECT policy then rather
-- than opening the table up before anything needs it.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));


-- ===========================================================================
-- FROM: supabase/migrations/00000000000003_cards.sql
-- ===========================================================================
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


-- ===========================================================================
-- FROM: supabase/migrations/00000000000004_locations.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- locations
--
-- User-defined physical containers: "Commander Binder", "Box 3", "Mono-Red
-- deck". This is the half of the product the charter calls the wedge.
--
-- AMENDABILITY NOTE. Phase 0 was skipped, so nesting depth is a guess. The
-- shape here is: an optional parent, with a trigger capping the tree at one
-- level ("Page 4" inside "Binder A"). Both of the plausible corrections are
-- one statement:
--   * people want flat locations  -> drop the column, or just stop offering a
--     parent in the UI
--   * people want deep nesting    -> `drop trigger locations_enforce_nesting on
--     public.locations;` and replace the depth check with a cycle check
-- No business logic below reads `parent_location_id`; it is a display concern
-- only. Keep it that way until interviews say otherwise.
-- ---------------------------------------------------------------------------

create table public.locations (
  id                 uuid primary key default extensions.gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null,

  -- text + CHECK rather than a Postgres enum, throughout this schema. Enums
  -- only grow gracefully (ALTER TYPE ... ADD VALUE); renaming or removing a
  -- value is a migration ordeal. A CHECK constraint is drop-and-recreate. Given
  -- the brief's "build migrations that are easy to amend", that trade favours
  -- CHECK. Same reasoning applies to condition and finish below.
  type               text not null default 'other'
                       check (type in ('deck', 'binder', 'box', 'other')),

  -- ON DELETE SET NULL: deleting "Binder A" promotes its pages to top level
  -- rather than cascading away containers full of someone's cards.
  parent_location_id uuid references public.locations (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint locations_name_length check (char_length(trim(name)) between 1 and 80),
  constraint locations_no_self_parent check (parent_location_id is distinct from id)
);

create index locations_user_id_idx on public.locations (user_id);
create index locations_parent_idx on public.locations (parent_location_id);

-- One "Page 1" per binder, but "Page 1" may exist in several binders. The
-- coalesce gives top-level locations a shared sentinel parent so they compete
-- with each other and not with nested ones.
create unique index locations_unique_name_per_parent
  on public.locations (
    user_id,
    coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Nesting rules: same owner, and at most one level deep.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_location_nesting()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_owner  uuid;
  parent_parent uuid;
begin
  if new.parent_location_id is null then
    return new;
  end if;

  select user_id, parent_location_id
    into parent_owner, parent_parent
    from public.locations
   where id = new.parent_location_id;

  if parent_owner is null then
    raise exception 'parent location % does not exist', new.parent_location_id
      using errcode = 'foreign_key_violation';
  end if;

  if parent_owner <> new.user_id then
    raise exception 'a location cannot be nested inside another user''s location'
      using errcode = 'check_violation';
  end if;

  -- Depth cap. Drop this trigger to allow arbitrary nesting (and add a cycle
  -- check if you do).
  if parent_parent is not null then
    raise exception 'locations support one level of nesting only'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.locations l where l.parent_location_id = new.id) then
    raise exception 'cannot nest a location that already has locations inside it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger locations_enforce_nesting
  before insert or update of parent_location_id, user_id on public.locations
  for each row execute function public.enforce_location_nesting();

-- ---------------------------------------------------------------------------
-- RLS: a location is visible and editable only by the user who owns it.
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;

create policy "locations: read own"
  on public.locations for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "locations: insert own"
  on public.locations for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "locations: update own"
  on public.locations for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "locations: delete own"
  on public.locations for delete
  to authenticated
  using (user_id = (select auth.uid()));


-- ===========================================================================
-- FROM: supabase/migrations/00000000000005_card_instances.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- card_instances
--
-- The owned copies. This is the table that makes the app an inventory system
-- rather than a checklist, and the table Phase 2's atomic trade transfer will
-- act on. Two design constraints came straight from the brief:
--
-- 1. OWNERSHIP AND LOCATION MUST NOT BE COUPLED.
--    `owner_user_id` and `location_id` are two independent, separately
--    updatable columns. There is no composite FK, no owner denormalised onto
--    the row from `locations`, no generated column tying them together. The
--    Phase 2 transfer is therefore exactly:
--
--        update card_instances
--           set owner_user_id = :recipient, location_id = null
--         where id = :instance_id;
--
--    ...and nothing else on the row needs touching. The one rule that does
--    span the two columns is enforced by a trigger, not by the schema shape:
--    you may not park a card in someone else's binder. Setting location_id to
--    null on transfer (which the data model already specifies as the desired
--    behaviour — received cards land "unsorted") satisfies it for free.
--
-- 2. STACKING IS AN UNVALIDATED GUESS, SO DO NOT BAKE IT IN.
--    `quantity` exists per the data model, but there is deliberately NO unique
--    constraint forcing identical cards to merge into one row. Whether two
--    copies of the same NM nonfoil common become quantity=2 or two rows is a
--    *policy*, and it lives in exactly one place in application code:
--    src/lib/collection/stacking.ts. Flipping to strict one-row-per-physical-
--    card is a one-file change with no migration. The index below exists to
--    make the merge lookup fast, not to enforce anything.
-- ---------------------------------------------------------------------------

create table public.card_instances (
  id             uuid primary key default extensions.gen_random_uuid(),

  owner_user_id  uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE RESTRICT: the Scryfall sync must never be able to delete
  -- somebody's collection out from under them by dropping a printing.
  card_id        uuid not null references public.cards (scryfall_id) on delete restrict,

  -- NULL is "unsorted", a real and expected state, not a missing value.
  -- ON DELETE SET NULL so deleting a binder unsorts its cards rather than
  -- destroying them.
  location_id    uuid references public.locations (id) on delete set null,

  condition      text not null default 'NM'
                   check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),

  -- Scryfall's finish vocabulary. Not FK-checked against
  -- cards.available_finishes: that array changes under us on every sync, and a
  -- sync that suddenly invalidated existing rows would be worse than a user
  -- claiming a foil that Scryfall says was never printed. The add/edit form
  -- constrains the choice; the DB constrains the vocabulary.
  finish         text not null default 'nonfoil'
                   check (finish in ('nonfoil', 'foil', 'etched', 'glossy')),

  -- The language of the physical card, which is NOT always the language of the
  -- printing row we synced. Scryfall's `default_cards` export carries one
  -- language per card, so a user who owns the Japanese Lightning Bolt still
  -- points at the English printing row. Storing language on the instance is
  -- what lets them record that truthfully.
  language       text not null default 'en'
                   check (char_length(language) between 2 and 5),

  quantity       integer not null default 1 check (quantity > 0),

  notes          text check (notes is null or char_length(notes) <= 500),

  acquired_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index card_instances_owner_idx    on public.card_instances (owner_user_id);
create index card_instances_location_idx on public.card_instances (location_id);
create index card_instances_card_idx     on public.card_instances (card_id);

-- Supports the "is there already a matching stack?" lookup in
-- src/lib/collection/stacking.ts. Intentionally NOT unique — see note 2 above.
create index card_instances_stack_lookup_idx
  on public.card_instances (owner_user_id, card_id, condition, finish, language, location_id);

create trigger card_instances_set_updated_at
  before update on public.card_instances
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The one cross-column rule: a card can only live in a location its owner owns.
--
-- Phase 2 note: the error text below is the fix. Null the location in the same
-- UPDATE that changes the owner and this never fires.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_instance_location_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  location_owner uuid;
begin
  if new.location_id is null then
    return new;
  end if;

  select user_id into location_owner
    from public.locations
   where id = new.location_id;

  if location_owner is null then
    raise exception 'location % does not exist', new.location_id
      using errcode = 'foreign_key_violation';
  end if;

  if location_owner <> new.owner_user_id then
    raise exception
      'card_instances.location_id must belong to owner_user_id; set location_id to NULL in the same statement that changes ownership'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger card_instances_enforce_location_owner
  before insert or update of location_id, owner_user_id on public.card_instances
  for each row execute function public.enforce_instance_location_owner();

-- ---------------------------------------------------------------------------
-- RLS: your cards, nobody else's.
--
-- Phase 2 will need the trade transaction to move a row from one user to
-- another. Do that in a SECURITY DEFINER function that validates the trade,
-- rather than by loosening these policies — a policy permitting
-- "owner_user_id = auth.uid() OR I am in a trade with the owner" is a much
-- larger blast radius than a single audited function.
-- ---------------------------------------------------------------------------
alter table public.card_instances enable row level security;

create policy "card_instances: read own"
  on public.card_instances for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create policy "card_instances: insert own"
  on public.card_instances for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

-- USING and WITH CHECK both pin the owner, so a user cannot hand a card to
-- someone else (or take one) by editing owner_user_id directly. Phase 2's
-- transfer runs as SECURITY DEFINER and is exempt.
create policy "card_instances: update own"
  on public.card_instances for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy "card_instances: delete own"
  on public.card_instances for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));


-- ===========================================================================
-- FROM: supabase/migrations/00000000000006_trading_forward_compat.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- Phase 2 forward-compatibility: trades, trade_items, ownership_history.
--
-- ***** THESE TABLES ARE NOT IN USE. *****
--
-- The Phase 1 brief permits creating them now for forward-compatibility and
-- explicitly forbids building logic or UI against them. Nothing in src/ reads
-- or writes them, and RLS is enabled with NO POLICIES, so they are deny-all to
-- every end user until Phase 2 deliberately opens them up. That is the
-- enforcement mechanism for "don't build against these yet": you cannot,
-- accidentally, from the app.
--
-- They exist here so that the Phase 2 session inherits FK targets and a
-- settled audit-log shape rather than starting from a blank schema. Phase 1
-- writes nothing to them, including on manual collection adds — that is Phase
-- 2's call to make, along with whether pre-trading history is worth
-- backfilling.
-- ---------------------------------------------------------------------------

create table public.trades (
  id           uuid primary key default extensions.gen_random_uuid(),
  proposer_id  uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'proposed'
                 check (status in ('proposed', 'countered', 'accepted',
                                   'declined', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint trades_distinct_parties check (proposer_id <> recipient_id)
);

create index trades_proposer_idx  on public.trades (proposer_id, status);
create index trades_recipient_idx on public.trades (recipient_id, status);

create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

create table public.trade_items (
  id               uuid primary key default extensions.gen_random_uuid(),
  trade_id         uuid not null references public.trades (id) on delete cascade,

  -- RESTRICT, not CASCADE: a card that is committed to an open trade must not
  -- vanish because someone deleted it from their collection mid-negotiation.
  -- Phase 2 should surface that as "cancel the trade first", which this
  -- constraint makes unavoidable rather than optional.
  card_instance_id uuid not null references public.card_instances (id) on delete restrict,

  direction        text not null
                     check (direction in ('from_proposer', 'from_recipient')),

  -- Supports trading part of a stack. The open question the data model flags —
  -- how to trade 3 of 5 copies — is a split-then-transfer inside the Phase 2
  -- transaction: decrement the source row's quantity, insert a new row for the
  -- traded portion owned by the recipient with location_id null. Nothing in
  -- this schema blocks that approach.
  quantity         integer not null default 1 check (quantity > 0),

  created_at       timestamptz not null default now()
);

create index trade_items_trade_idx    on public.trade_items (trade_id);
create index trade_items_instance_idx on public.trade_items (card_instance_id);

-- ---------------------------------------------------------------------------
-- ownership_history — append-only audit log.
--
-- The data model calls this "what makes the transfer trustworthy". An audit log
-- you can quietly edit is not an audit log, so the guard below is a trigger
-- rather than a convention: UPDATE and DELETE always raise, for every role
-- including the service role.
--
-- None of card_instance_id, from_user_id or to_user_id is a foreign key. An
-- audit record must outlive the rows it describes: a CASCADE would erase the
-- history along with a deleted card or a closed account, a RESTRICT would make
-- those deletions impossible, and SET NULL would quietly corrupt the record.
-- The cost is that these ids can dangle, which is the correct trade for a log.
-- trade_id is the exception — trades are never hard-deleted (they end in a
-- terminal status), so the FK there is free.
-- ---------------------------------------------------------------------------
create table public.ownership_history (
  id               uuid primary key default extensions.gen_random_uuid(),
  card_instance_id uuid not null,
  from_user_id     uuid,                                                  -- null = newly created instance
  to_user_id       uuid not null,
  trade_id         uuid references public.trades (id) on delete set null, -- null = manual add/edit, not a trade
  transferred_at   timestamptz not null default now()
);

create index ownership_history_instance_idx on public.ownership_history (card_instance_id, transferred_at);
create index ownership_history_to_user_idx  on public.ownership_history (to_user_id, transferred_at desc);

create or replace function public.reject_ownership_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ownership_history is append-only; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger ownership_history_is_append_only
  before update or delete on public.ownership_history
  for each row execute function public.reject_ownership_history_mutation();

-- ---------------------------------------------------------------------------
-- RLS enabled, no policies: deny-all for anon and authenticated. Phase 2 adds
-- the policies it needs. Do not add them here.
-- ---------------------------------------------------------------------------
alter table public.trades            enable row level security;
alter table public.trade_items       enable row level security;
alter table public.ownership_history enable row level security;

