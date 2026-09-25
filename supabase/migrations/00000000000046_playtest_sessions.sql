-- ---------------------------------------------------------------------------
-- playtest_sessions: saved Play-mode games, one owner, one deck.
--
-- WHY THIS EXISTS
--
-- The Play tabletop (/decks/[id]/play) is entirely client-side: every draw,
-- tap and move happens in the browser against a pure reducer, and a crash
-- costs at most the last second (localStorage recovery, see
-- src/lib/playtest/recovery.ts). That is enough to survive a refresh. It is
-- not enough to pick a game up on another device or keep an interesting board
-- ("the turn-four Krenko line") for later, so a player can also SAVE a game to
-- their account. That is the only reason this table exists, and it is the only
-- thing that ever writes to it.
--
-- WHAT A SESSION IS NOT
--
-- A session is not a location and not a collection record. Playing never
-- touches deck_cards, card_instances, locations or ownership_history; the
-- application enforces that with lint fences and a test that reads the server
-- actions (scripts/playtest-boundary.test.ts), and this table is deliberately
-- the only thing those actions may write. A saved game is a JSON snapshot of a
-- game of Magic. It says nothing about where a physical card is.
--
-- THE DECISIONS THAT ARE EASY TO GET WRONG
--
-- 1. A public deck is not a public session. Migration 35 lets an accepted
--    friend read a public deck's `locations` row and its `deck_cards` list, so
--    a friend can SEE deck_id. Nothing about that gives them a session, and
--    nothing here does either: there is no friend policy on this table, so
--    every read, write and delete is owner-only.
--
--    The write side is the subtle one. "Alice's deck is visible to Bob" plus
--    a plain foreign key would let Bob insert a row naming Alice's deck, since
--    a foreign key only checks that the deck EXISTS, not whose it is. So the
--    insert trigger below looks the deck up and refuses unless its owner is the
--    row's owner AND it is type 'deck'. That trigger is the only thing between
--    a friend and a save against your deck (RLS pins owner_user_id to the
--    caller, but says nothing about deck_id), and the schema test proves it can
--    fail by removing the owner comparison.
--
-- 2. Deleting a deck deletes its saves (ON DELETE CASCADE on deck_id). This is
--    the owner's decision: a saved game of a deck that no longer exists cannot
--    be resumed against anything, and orphaned saves would still count against
--    the quota. Deleting the account removes everything, as with every other
--    user-owned table.
--
-- 3. deck_id and owner_user_id are immutable to clients. The grants below give
--    UPDATE on the five columns a rename/overwrite legitimately changes and no
--    others, so "move this save to another deck" is a permission error rather
--    than a policy someone has to remember. (Migration 24's lesson: default
--    privileges in this schema hand every new table to anon, authenticated and
--    service_role, so grants are taken back first and given out by name.)
--
-- 4. Size is bounded by the database, not only by the server action. The
--    snapshot check is on the text length of the jsonb (length(snapshot::text))
--    and NOT on pg_column_size: that measures the TOASTed, compressed storage,
--    which would let a highly repetitive 5MB blob through. 256KB is the cap;
--    a fresh 100-card game measures about 55KB and a full 1,000-entry log about
--    90KB (see the architect map), so the cap has real headroom. The
--    schema_version and source_fingerprint columns must equal what is inside
--    the snapshot (compared as JSON, not cast from text, so a snapshot with
--    "schemaVersion": "abc" is a check violation and not a cast error), which
--    keeps the columns the page filters on honest.
--
-- 5. Quotas: 10 saves per deck and 30 per user. Counted under an advisory lock
--    keyed on the owner so two simultaneous saves cannot both squeeze past the
--    last slot. The lock is per transaction and is taken even when the row is
--    about to be refused by RLS; the worst a caller can do is briefly serialise
--    their own inserts against someone else's key, which only their own
--    transaction ever holds. The error message begins with a fixed prefix
--    ("playtest_sessions_quota") that src/lib/supabase/errors.ts turns into
--    plain wording.
--
-- 6. `preview` is a small jsonb (turn, life, zone counts, format) computed by
--    the server action from the VALIDATED state, never taken from the client.
--    It exists so the saved-games list can show "Turn 5 - 31 life - 12 in hand"
--    without downloading and parsing every snapshot. Capped at 2KB.
--
-- No RLS policy on any other table changes. No existing grant changes.
-- ---------------------------------------------------------------------------

create table public.playtest_sessions (
  id             uuid primary key default extensions.gen_random_uuid(),

  -- Defaults to the caller so the server action need not pass it; the INSERT
  -- policy pins it to auth.uid() regardless.
  owner_user_id  uuid not null
                   references auth.users (id) on delete cascade
                   default auth.uid(),

  deck_id        uuid not null
                   references public.locations (id) on delete cascade,

  -- `~ '\S'` demands a non-whitespace character (btrim strips spaces only, so
  -- a length test alone would accept E'\n\n'); the cap is on the trimmed text.
  title          text not null
                   constraint playtest_sessions_title_length
                   check (title ~ '\S' and char_length(btrim(title)) <= 100),

  schema_version integer not null,

  source_fingerprint text not null
                   constraint playtest_sessions_fingerprint_shape
                   check (source_fingerprint ~ '^[0-9a-f]{64}$'),

  snapshot       jsonb not null
                   constraint playtest_sessions_snapshot_size
                   check (jsonb_typeof(snapshot) = 'object' and length(snapshot::text) <= 262144),

  preview        jsonb not null
                   constraint playtest_sessions_preview_size
                   check (jsonb_typeof(preview) = 'object' and length(preview::text) <= 2048),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- The columns the page filters on must agree with the blob they describe.
  -- `is not distinct from`, not `=`: a snapshot MISSING the key yields NULL,
  -- and a CHECK passes on NULL, which would let exactly the malformed blob
  -- these constraints exist to stop straight through.
  constraint playtest_sessions_version_matches
    check ((snapshot -> 'schemaVersion') is not distinct from to_jsonb(schema_version)),
  constraint playtest_sessions_fingerprint_matches
    check ((snapshot #> '{source,fingerprint}') is not distinct from to_jsonb(source_fingerprint))
);

comment on table public.playtest_sessions is
  'Saved Play-mode games. Owner-only. A JSON snapshot of a game, never a record of where a physical card is. See migration 46.';

-- The saved-games list: one owner's saves for one deck, newest first.
create index playtest_sessions_owner_deck_idx
  on public.playtest_sessions (owner_user_id, deck_id, updated_at desc);

-- Deleting a deck cascades here; without this it would scan the table.
create index playtest_sessions_deck_idx
  on public.playtest_sessions (deck_id);

create trigger playtest_sessions_set_updated_at
  before update on public.playtest_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The deck must be the row owner's own, and a deck. Same shape as migration
-- 17's enforce_want_deck_owner, and deliberately NOT security definer: it runs
-- as the caller, so it can only see decks the caller can already see. That is
-- enough, and it is the point: a deck the caller cannot see is refused as
-- "does not exist", and a deck a friend can see (migration 35) is refused as
-- "not yours". Both refuse.
--
-- Shared with playtest_shares (migration 47), which has the same two columns.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_playtest_deck_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  deck_owner uuid;
  deck_type  text;
begin
  select user_id, type into deck_owner, deck_type
    from public.locations
   where id = new.deck_id;

  if deck_owner is null then
    raise exception 'deck % does not exist', new.deck_id
      using errcode = 'foreign_key_violation';
  end if;

  if deck_owner <> new.owner_user_id then
    raise exception 'a playtest row must belong to the owner of its deck'
      using errcode = 'check_violation';
  end if;

  if deck_type <> 'deck' then
    raise exception 'a playtest row must reference a location of type deck'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger playtest_sessions_enforce_deck_owner
  before insert or update of deck_id, owner_user_id on public.playtest_sessions
  for each row execute function public.enforce_playtest_deck_owner();

-- ---------------------------------------------------------------------------
-- Quota: 10 saves per deck, 30 per user.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_playtest_session_quota()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  per_deck int;
  per_user int;
begin
  -- Serialise this owner's inserts so two tabs cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('playtest_sessions:' || new.owner_user_id::text, 0));

  select count(*) filter (where deck_id = new.deck_id), count(*)
    into per_deck, per_user
    from public.playtest_sessions
   where owner_user_id = new.owner_user_id;

  if per_deck >= 10 then
    raise exception 'playtest_sessions_quota_deck: a deck can hold at most 10 saved games'
      using errcode = 'check_violation';
  end if;
  if per_user >= 30 then
    raise exception 'playtest_sessions_quota_user: an account can hold at most 30 saved games'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger playtest_sessions_enforce_quota
  before insert on public.playtest_sessions
  for each row execute function public.enforce_playtest_session_quota();

-- ---------------------------------------------------------------------------
-- Row-level security: owner only, in both USING and WITH CHECK so an update
-- cannot hand a row to someone else. No friend policy of any kind.
-- ---------------------------------------------------------------------------

alter table public.playtest_sessions enable row level security;

create policy "playtest_sessions: read own"
  on public.playtest_sessions for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create policy "playtest_sessions: insert own"
  on public.playtest_sessions for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy "playtest_sessions: update own"
  on public.playtest_sessions for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy "playtest_sessions: delete own"
  on public.playtest_sessions for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants: take everything back, hand out by name. anon gets nothing at all,
-- so an anonymous request is a permission error, not an empty result.
-- service_role is revoked too: it bypasses RLS, nothing needs it here, and its
-- write grant would be the only thing between the service key and this table.
-- ---------------------------------------------------------------------------

revoke all on public.playtest_sessions from public, anon, authenticated, service_role;

grant select, insert, delete on public.playtest_sessions to authenticated;

-- deck_id and owner_user_id are absent on purpose: immutable to clients.
grant update (title, snapshot, schema_version, source_fingerprint, preview)
  on public.playtest_sessions to authenticated;
