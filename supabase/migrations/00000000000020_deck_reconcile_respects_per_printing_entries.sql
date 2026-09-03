-- ---------------------------------------------------------------------------
-- The deck reconcile trigger must respect per-printing list entries.
--
-- Migration 19 made "anything physically in a deck is on that deck's list"
-- reconcile by oracle id: on every card_instance filed into a deck, it bumped
-- the oldest list entry for that card to `greatest(quantity, <copies of the
-- card, any printing, now in the deck>)`.
--
-- That silently corrupts a deck that lists the same card in more than one
-- printing on purpose -- 14 of one Forest art, 6 of another. Sleeve all 20 and
-- the trigger sets the *oldest* Forest entry to 20 and leaves the other at 6:
-- the list now totals 26 Forests, and every later sleeve inflates it further. A
-- 100-card deck imported and sleeved this way grew to 114.
--
-- The fix: compare totals, not one entry. The list only needs adjusting when a
-- deck physically holds *more* copies of a card than the list asks for across
-- all its entries. When it does, add just the shortfall -- to the entry that
-- names the exact printing if there is one, else the oldest entry for the card,
-- else a new row. Sleeving copies the list already accounts for changes
-- nothing, which is the normal case.
--
-- No backfill: a list where sum(quantity) already exceeds the physical count
-- cannot be told apart from a deliberately aspirational one, so decks corrupted
-- by the old trigger are cleared by deleting and re-importing them.
-- ---------------------------------------------------------------------------

create or replace function public.list_card_when_filed_in_deck()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_deck        boolean;
  v_oracle_id      uuid;
  v_physical_total integer;
  v_listed_total   integer;
  v_shortfall      integer;
  v_entry_id       uuid;
begin
  if new.location_id is null then
    return null;
  end if;

  select (l.type = 'deck')
    into v_is_deck
    from public.locations l
   where l.id = new.location_id;

  if v_is_deck is not true then
    return null;
  end if;

  select c.oracle_id
    into v_oracle_id
    from public.cards c
   where c.scryfall_id = new.card_id;

  -- Every copy of this card -- any printing -- now physically in this deck.
  -- AFTER trigger, so NEW is already counted.
  select coalesce(sum(ci.quantity), 0)
    into v_physical_total
    from public.card_instances ci
    join public.cards c on c.scryfall_id = ci.card_id
   where ci.location_id = new.location_id
     and (
       (v_oracle_id is not null and c.oracle_id = v_oracle_id)
       or (v_oracle_id is null and ci.card_id = new.card_id)
     );

  -- What the list already asks for this card, summed across every entry for it
  -- (any printing).
  select coalesce(sum(dc.quantity), 0)
    into v_listed_total
    from public.deck_cards dc
    join public.cards c on c.scryfall_id = dc.card_id
   where dc.deck_id = new.location_id
     and (
       (v_oracle_id is not null and c.oracle_id = v_oracle_id)
       or (v_oracle_id is null and dc.card_id = new.card_id)
     );

  -- The list already covers what is sleeved. Nothing to do -- and crucially,
  -- per-printing entries keep their own quantities.
  if v_physical_total <= v_listed_total then
    return null;
  end if;

  v_shortfall := v_physical_total - v_listed_total;

  -- Over-sleeved: add the shortfall. Prefer an entry that names this exact
  -- printing, then the oldest entry for the card, then a fresh row.
  select dc.id
    into v_entry_id
    from public.deck_cards dc
   where dc.deck_id = new.location_id
     and dc.card_id = new.card_id
   limit 1;

  if v_entry_id is null then
    select dc.id
      into v_entry_id
      from public.deck_cards dc
      join public.cards c on c.scryfall_id = dc.card_id
     where dc.deck_id = new.location_id
       and (
         (v_oracle_id is not null and c.oracle_id = v_oracle_id)
         or (v_oracle_id is null and dc.card_id = new.card_id)
       )
     order by dc.created_at, dc.id
     limit 1;
  end if;

  if v_entry_id is not null then
    update public.deck_cards
       set quantity = quantity + v_shortfall
     where id = v_entry_id;
  else
    insert into public.deck_cards (deck_id, card_id, quantity)
    values (new.location_id, new.card_id, v_shortfall)
    on conflict (deck_id, card_id) do update
      set quantity = public.deck_cards.quantity + excluded.quantity;
  end if;

  return null;
end;
$$;
