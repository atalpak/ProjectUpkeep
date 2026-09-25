-- ---------------------------------------------------------------------------
-- playtest_shares: a redacted, read-only view of a game, readable by SIGNED-IN
-- people who hold the link. Nothing more.
--
-- WHAT THIS CHANGES ABOUT THE PRODUCT, AND WHAT IT DOES NOT
--
-- Migration 35's header says "there is no anonymous read path anywhere". That
-- stays true: this migration adds NO anonymous read path, NO grant to anon,
-- and no public route. It supersedes that sentence in exactly one sense: a
-- signed-in reader who holds a share link can now read a REDACTED projection
-- of one of your games, whether or not they are your friend. The owner chose
-- this on 2026-09-25 (option B: signed-in users with the link) over an open
-- link, so a share is not indexable, not fetchable by a crawler, and every
-- reader is an account that accepted the terms.
--
-- The share is deliberately NOT a copy of the owner's snapshot. The projection
-- (src/lib/playtest/board/share.ts, built on the server) is assembled from an
-- allow-list: no hand unless the owner chose to show it, no library order, no
-- seeds, no notes, no object ids, no deck id, no owner. Everything below is
-- about making that payload readable to the right people and nobody else; what
-- is IN it is share.ts's job and is tested by a leak test there.
--
-- THE DECISIONS THAT ARE EASY TO GET WRONG
--
-- 1. The token is minted by the database, never by the client. It is 16 random
--    bytes (128 bits) as hex, and the column is not granted for INSERT: a
--    client that tries to supply its own gets a permission error, so a
--    predictable or attacker-chosen link cannot exist. The owner can read it
--    back (they need it to build the URL); nobody else can list it.
--
-- 2. The only read path for a non-owner is public.get_playtest_share(token),
--    a SECURITY DEFINER function. It returns null unless the token is
--    well-formed, exists and has not expired, and it returns ONLY the title,
--    the projection and the two timestamps as one jsonb value, never the owner
--    id, the deck id or the username. It is executable by `authenticated` ONLY:
--    revoked from public, anon and service_role. A signed-out request is a
--    permission error, not a null, which is the assertion that keeps option B
--    honest. The table itself has no policy a reader could use, so a reader
--    cannot enumerate tokens or look up "shares for this deck".
--    The function is `set search_path = ''` and fully qualifies every name, the
--    standard hardening for definer functions.
--
-- 3. Same ownership trigger as migration 46. A friend can see your public deck
--    (migration 35), so without it a friend could publish a "share" of YOUR
--    deck under their own account. The trigger function is shared with
--    playtest_sessions.
--
-- 4. Shares expire: 30 days by default, never more than 90 from creation
--    (a CHECK, so even a hand-edited row cannot outlive it). Revoking a share
--    is deleting the row. A share is independent of the save it came from:
--    deleting a save does not revoke a share, deleting the DECK does (cascade),
--    and so does deleting the account.
--
-- 5. Quota: 10 unexpired shares per user, under an advisory lock, with a fixed
--    message prefix (playtest_shares_quota) that errors.ts turns into plain
--    wording. The createShare action deletes the caller's already-expired
--    shares first, so expiry frees slots.
--
-- 6. Sizes: the projection is capped at 131,072 characters of text (a 100-card
--    table with a full public log is well under that), projection_version must
--    match the version inside the jsonb, and the title is 1..100.
--
-- Unverified and worth saying: whether Scryfall's terms are comfortable with
-- card images being loaded from cards.scryfall.io by signed-in readers of a
-- shared table. Images are only ever hot-linked from Scryfall's own host (the
-- projection drops every other URL), which is the pattern their guidelines
-- describe, but that is the owner's call to confirm before this ships.
-- ---------------------------------------------------------------------------

create table public.playtest_shares (
  id             uuid primary key default extensions.gen_random_uuid(),

  owner_user_id  uuid not null
                   references auth.users (id) on delete cascade
                   default auth.uid(),

  deck_id        uuid not null
                   references public.locations (id) on delete cascade,

  -- 128 bits from the database. Not granted for INSERT (see below).
  token          text not null unique
                   default encode(extensions.gen_random_bytes(16), 'hex')
                   constraint playtest_shares_token_shape
                   check (token ~ '^[0-9a-f]{32}$'),

  title          text not null
                   constraint playtest_shares_title_length
                   check (title ~ '\S' and char_length(btrim(title)) <= 100),

  projection     jsonb not null
                   constraint playtest_shares_projection_size
                   check (jsonb_typeof(projection) = 'object' and length(projection::text) <= 131072),

  projection_version integer not null,

  show_hand      boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  expires_at     timestamptz not null default (now() + interval '30 days'),

  -- `is not distinct from` for the same reason as migration 46: a projection
  -- missing its version must fail, not pass as NULL.
  constraint playtest_shares_version_matches
    check ((projection -> 'version') is not distinct from to_jsonb(projection_version)),
  constraint playtest_shares_expiry_cap
    check (expires_at <= created_at + interval '90 days')
);

comment on table public.playtest_shares is
  'A redacted projection of a Play-mode game, readable by signed-in holders of the token via get_playtest_share(). No anonymous access. See migration 47.';

create index playtest_shares_owner_idx on public.playtest_shares (owner_user_id, expires_at desc);
create index playtest_shares_deck_idx on public.playtest_shares (deck_id);

create trigger playtest_shares_set_updated_at
  before update on public.playtest_shares
  for each row execute function public.set_updated_at();

create trigger playtest_shares_enforce_deck_owner
  before insert or update of deck_id, owner_user_id on public.playtest_shares
  for each row execute function public.enforce_playtest_deck_owner();

-- ---------------------------------------------------------------------------
-- Quota: 10 unexpired shares per user.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_playtest_share_quota()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  live int;
begin
  perform pg_advisory_xact_lock(hashtextextended('playtest_shares:' || new.owner_user_id::text, 0));

  select count(*) into live
    from public.playtest_shares
   where owner_user_id = new.owner_user_id
     and expires_at > now();

  if live >= 10 then
    raise exception 'playtest_shares_quota: an account can hold at most 10 active shared tables'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger playtest_shares_enforce_quota
  before insert on public.playtest_shares
  for each row execute function public.enforce_playtest_share_quota();

-- ---------------------------------------------------------------------------
-- Row-level security: the OWNER manages their shares; nobody else touches the
-- table. Readers go through get_playtest_share() below, never through here.
-- ---------------------------------------------------------------------------

alter table public.playtest_shares enable row level security;

create policy "playtest_shares: read own"
  on public.playtest_shares for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create policy "playtest_shares: insert own"
  on public.playtest_shares for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy "playtest_shares: update own"
  on public.playtest_shares for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy "playtest_shares: delete own"
  on public.playtest_shares for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));

revoke all on public.playtest_shares from public, anon, authenticated, service_role;

grant select, delete on public.playtest_shares to authenticated;

-- `token` (and id / created_at / updated_at) are absent from the INSERT grant:
-- the database mints them. Supplying a token is a permission error.
grant insert (owner_user_id, deck_id, title, projection, projection_version, show_hand, expires_at)
  on public.playtest_shares to authenticated;

-- deck_id / owner_user_id / token are immutable to clients.
grant update (title, projection, projection_version, show_hand, expires_at)
  on public.playtest_shares to authenticated;

-- ---------------------------------------------------------------------------
-- The one read path for a non-owner.
-- ---------------------------------------------------------------------------

create or replace function public.get_playtest_share(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'title', s.title,
           'projection', s.projection,
           'updatedAt', s.updated_at,
           'expiresAt', s.expires_at
         )
    from public.playtest_shares s
   where p_token ~ '^[0-9a-f]{32}$'
     and s.token = p_token
     and s.expires_at > now();
$$;

-- Signed-in only. `public` is the pseudo-role every role inherits, and Supabase
-- also grants execute on new functions to anon and service_role by default, so
-- all four are taken back before authenticated is given the one it needs.
revoke all on function public.get_playtest_share(text) from public, anon, authenticated, service_role;
grant execute on function public.get_playtest_share(text) to authenticated;
