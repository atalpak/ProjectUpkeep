-- ---------------------------------------------------------------------------
-- Commander, take two: a card on the list, not a copy in the box.
--
-- Migration 8 pointed the designation at `card_instances.id` -- a specific
-- physical copy. That was wrong: it means you cannot nominate a commander
-- until you own one, which is backwards for a deckbuilder who is still
-- shopping for it. The application code even tried to hand it a
-- `cards.scryfall_id` instead (src/app/(app)/decks/actions.ts, pre-fix), which
-- the FK correctly rejected every time -- silently, because the caller threw
-- the error away. Nominating a commander has therefore never actually worked.
--
-- The fix: point the column at the card, via `cards.scryfall_id`, exactly the
-- same reference `deck_cards.card_id` already uses for a decklist entry's
-- representative printing. A commander is a role given to one line of the
-- list, so it is keyed the same way the list itself is.
--
-- commander_instance_id is kept, not dropped: an additive migration should
-- not remove a column something might still reference, and rollback needs
-- somewhere to land. It is deprecated in place -- see the comment below -- and
-- nothing after this migration writes to it.
--
-- Every design note from migration 8 still holds and is not repeated in full:
-- nullable, ON DELETE SET NULL, no legality/format enforcement (out of scope,
-- docs/CHARTER.md).
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists commander_card_id uuid
    references public.cards (scryfall_id) on delete set null;

comment on column public.locations.commander_card_id is
  'The card acting as this deck''s commander -- a printing on the decklist, '
  'not a physical copy. Null for every other location type, and for a deck '
  'with no nomination yet. Replaces commander_instance_id (migration 8); see '
  'migration 18.';

-- Carry forward any nomination made before this migration. A location whose
-- commander_instance_id pointed at a card_instance that has since been
-- deleted (ON DELETE SET NULL already cleared it) has nothing to carry.
update public.locations l
   set commander_card_id = ci.card_id
  from public.card_instances ci
 where ci.id = l.commander_instance_id
   and l.commander_instance_id is not null
   and l.commander_card_id is null;

comment on column public.locations.commander_instance_id is
  'Deprecated by migration 18 -- use commander_card_id. This column names a '
  'physical copy, which cannot represent a commander you have not bought yet. '
  'Do not write to it; it is kept only as a landing place for a rollback.';
