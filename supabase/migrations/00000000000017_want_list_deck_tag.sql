-- ---------------------------------------------------------------------------
-- Tagging a want to a deck.
--
-- The product's call: extend want_list rather than stand up a parallel
-- per-deck table. A want is still "I want this card, full stop" — deck_id is
-- an optional tag on top of that, answering "which deck am I getting it
-- for", not a second, differently-keyed row.
--
-- ONE TAG, NOT ONE ROW PER (WANT, DECK). Wanting a card for two decks at once
-- is still one shopping-list line in real life — you need one more Sol Ring,
-- and it happens to answer both decks. The unique index therefore stays
-- (user_id, card_id) from migration 15, untouched: a want is still unique per
-- user per printing, and deck_id rides along as a plain nullable column, not
-- part of that key.
--
-- If a future brief wants one want per (user, card, deck) instead — e.g. "I
-- need one for the Atarka deck AND one for the cube" as two distinct lines —
-- widening the unique index is the change, and it is not a free one: Postgres
-- treats NULL as distinct from NULL in a plain unique index, so an untagged
-- want and a deck-tagged want for the same card would NOT collide under
-- (user_id, card_id, deck_id) as written. Getting the current single-tag
-- behaviour back on that wider index needs `nulls not distinct` (PG15+) or a
-- pair of partial unique indexes (one `where deck_id is null`, one without
-- the predicate). Noting it here so whoever makes that change does not
-- discover the NULL behaviour by shipping a duplicate want.
--
-- ON DELETE SET NULL, matching the commander pattern in migration 8: taking a
-- deck apart detags the want, it does not delete it. You still want the
-- card; you just stopped building the deck you wanted it for.
-- ---------------------------------------------------------------------------

alter table public.want_list
  add column if not exists deck_id uuid
    references public.locations (id) on delete set null;

comment on column public.want_list.deck_id is
  'Optional tag: which deck this want is for. Null = not tied to a deck. A '
  'want stays on the global list either way -- see migration 17.';

create index if not exists want_list_deck_idx on public.want_list (deck_id);

-- ---------------------------------------------------------------------------
-- A want can only be tagged to a deck its own user owns, and specifically a
-- deck -- tagging a want to a binder would not mean anything. Same shape as
-- card_instances -> locations in migration 5 (enforce_instance_location_owner).
-- ---------------------------------------------------------------------------

create or replace function public.enforce_want_deck_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  deck_owner uuid;
  deck_type  text;
begin
  if new.deck_id is null then
    return new;
  end if;

  select user_id, type into deck_owner, deck_type
    from public.locations
   where id = new.deck_id;

  if deck_owner is null then
    raise exception 'deck % does not exist', new.deck_id
      using errcode = 'foreign_key_violation';
  end if;

  if deck_owner <> new.user_id then
    raise exception 'want_list.deck_id must belong to the same user as want_list.user_id'
      using errcode = 'check_violation';
  end if;

  if deck_type <> 'deck' then
    raise exception 'want_list.deck_id must reference a location of type deck'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists want_list_enforce_deck_owner on public.want_list;
create trigger want_list_enforce_deck_owner
  before insert or update of deck_id, user_id on public.want_list
  for each row execute function public.enforce_want_deck_owner();

-- ---------------------------------------------------------------------------
-- No RLS change needed. The existing policies from migration 15 are scoped on
-- want_list.user_id, and that scoping already covers the new column: your own
-- rows are fully read/writable, a friend's row is read-only, same as before.
--
-- deck_id does technically travel to a friend inside that read-only row (the
-- "read own and friends'" policy returns the whole row), same as `note`
-- already does. That is fine on its own terms -- it is an opaque id a friend
-- cannot dereference, because "locations: read own" (migration 4) does not
-- grant them a read on someone else's deck. It is deliberately NOT relied on
-- here, though: the application layer (src/lib/social/queries.ts) never
-- selects deck_id when building a friend's want-list view, so a friend's
-- payload never carries it regardless of what RLS would have allowed through.
-- Belt and suspenders, because the one case where RLS alone would not be
-- enough is real -- a deck marked is_tradable (migration 9) IS independently
-- readable by a friend, and a UUID they can already resolve name is more than
-- "cannot infer anything new" -- see src/lib/social/queries.ts.
-- ---------------------------------------------------------------------------
