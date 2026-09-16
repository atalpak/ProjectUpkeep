-- ---------------------------------------------------------------------------
-- Deck visibility: an owner can share a decklist with accepted friends.
--
-- This lands on `locations`, not a new table, for the same reason migration 21
-- put notes/format/tags there: a deck is a `locations` row of type 'deck', and
-- keeping deck-only attributes flat on that table costs nothing on a box or
-- binder, which simply leaves the column at its default.
--
-- `is_public` means "visible to my accepted friends", not "visible to the
-- internet". Every policy in this schema is `to authenticated` — there is no
-- anonymous read path anywhere, and this migration does not add one.
--
-- What this deliberately does NOT touch: `card_instances` RLS is unchanged.
-- Sharing a decklist is sharing the cards a deck *wants* — commander, format,
-- tags, the `deck_cards` list — not which physical copies are sleeved into it.
-- A friend who can see a public deck must not gain any new way to see
-- `card_instances`, which stays governed entirely by `is_tradable` (migration
-- 9). That boundary is the point of this feature, not an afterthought.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists is_public boolean not null default false;

comment on column public.locations.is_public is
  'When true and type = ''deck'', this deck''s card list (not its sleeved copies) is visible to the owner''s accepted friends.';

create index if not exists locations_public_decks_idx
  on public.locations (user_id) where is_public;

-- ---------------------------------------------------------------------------
-- Seeing a friend's public deck
--
-- Mirrors the "locations: read friends' tradable" shape from migration 9:
-- both halves are required, friendship AND the flag. `type = 'deck'` is
-- enforced here rather than with a CHECK constraint (see the decision note
-- above locations.is_public's default), because a CHECK cannot see whether a
-- non-deck row flipped the flag by accident, and RLS is where this schema
-- already enforces deck-only predicates (deck_cards, migration 10).
-- ---------------------------------------------------------------------------

drop policy if exists "locations: read friends' public decks" on public.locations;
create policy "locations: read friends' public decks"
  on public.locations for select
  to authenticated
  using (
    is_public
    and type = 'deck'
    and public.are_friends(user_id, (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Seeing that deck's list
--
-- The predicate is restated in full rather than assumed from the locations
-- policy above, because a policy on one table is not implicitly enforced by a
-- policy on another — deck_cards needs its own equivalent check.
-- ---------------------------------------------------------------------------

drop policy if exists "deck_cards: read friends' public decks" on public.deck_cards;
create policy "deck_cards: read friends' public decks"
  on public.deck_cards for select
  to authenticated
  using (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id
         and l.is_public
         and l.type = 'deck'
         and public.are_friends(l.user_id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- This makes three previously-unscoped `deck_cards` reads in
-- src/lib/collection/queries.ts unsafe: getDecks, getCrossDeckAvailableCount
-- and getDeckList all read deck_cards without an explicit owner filter, on
-- the assumption (true until now) that no other user's deck_cards row could
-- ever be visible through RLS. That assumption breaks the moment a friend
-- makes a deck public, so all three were scoped to the caller's own decks in
-- the same change that adds this migration.
-- ---------------------------------------------------------------------------
