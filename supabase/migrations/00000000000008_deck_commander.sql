-- Commander designation.
--
-- "Commander" is the one deck section that is not a card type. Atarka, World
-- Render is a Legendary Creature wherever it sits; what makes it a commander is
-- the role it has been given *in one deck*. So it is recorded on the deck, not
-- on the card.
--
-- ON DELETE SET NULL: taking the commander out of the deck clears the
-- designation rather than leaving a pointer to a row that is somewhere else.
-- The card itself is untouched.
--
-- Nullable and unenforced on purpose. Nothing here checks that the card is
-- legendary, that it is in this deck, or that the deck is Commander format —
-- format legality is explicitly out of scope (docs/CHARTER.md §37), and a
-- constraint that fought the user over an un-sleeved commander or a
-- Commander-legal planeswalker would be worse than none.

alter table public.locations
  add column if not exists commander_instance_id uuid
    references public.card_instances (id) on delete set null;

comment on column public.locations.commander_instance_id is
  'The card_instance acting as this deck''s commander. Null for every other location type.';
