-- ---------------------------------------------------------------------------
-- A deck's list reconciles by oracle id, not by exact printing.
--
-- Migration 16 made "anything physically in a deck is on that deck's list" true
-- with a trigger, but keyed it on the exact printing (card_id). Every other
-- part of the deck model counts across printings by oracle id -- a list entry
-- for "Lightning Bolt" is satisfied by any Lightning Bolt, in any printing.
--
-- The mismatch was invisible until the deck page grew a "change printing"
-- control: point an entry at a printing you do not own, sleeve a copy of the
-- printing you do, and the old trigger filed a *second* list entry for it.
--
-- This rewrites the trigger to look for an existing entry for any printing of
-- the same card and bump that one, rather than add a sibling. Exact card_id is
-- used only as a fallback, for the rare card with no oracle id in our data.
--
-- A one-off backfill folds any sibling-printing duplicates the old trigger
-- already created into one entry per (deck, oracle id).
-- ---------------------------------------------------------------------------

create or replace function public.list_card_when_filed_in_deck()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_deck   boolean;
  v_oracle_id uuid;
  v_physical  integer;
  v_entry_id  uuid;
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

  -- Every copy of this *card* -- any printing -- now physically in this deck.
  -- AFTER trigger, so NEW is already counted.
  select coalesce(sum(ci.quantity), 0)
    into v_physical
    from public.card_instances ci
    join public.cards c on c.scryfall_id = ci.card_id
   where ci.location_id = new.location_id
     and (
       (v_oracle_id is not null and c.oracle_id = v_oracle_id)
       or (v_oracle_id is null and ci.card_id = new.card_id)
     );

  -- An existing list entry for any printing of this card, oldest first.
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

  if v_entry_id is not null then
    -- Keep the printing the entry already names; only make sure its quantity
    -- covers what is sleeved. Never lower it -- an aspirational "want 4, own 1"
    -- stays 4. (deck_cards_set_updated_at keeps updated_at current.)
    update public.deck_cards
       set quantity = greatest(quantity, v_physical)
     where id = v_entry_id;
  else
    insert into public.deck_cards (deck_id, card_id, quantity)
    values (new.location_id, new.card_id, greatest(v_physical, 1))
    on conflict (deck_id, card_id) do update
      set quantity = greatest(deck_cards.quantity, excluded.quantity);
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: one entry per (deck, oracle id). The oldest entry in each group
-- survives and absorbs the group's total quantity; the rest are removed.
-- ---------------------------------------------------------------------------

-- 1. Survivor absorbs the whole group's quantity.
with grp as (
  select
    dc.id,
    dc.quantity,
    first_value(dc.id) over (
      partition by dc.deck_id, c.oracle_id
      order by dc.created_at, dc.id
    ) as keep_id
  from public.deck_cards dc
  join public.cards c on c.scryfall_id = dc.card_id
  where c.oracle_id is not null
),
totals as (
  select keep_id, sum(quantity) as total_qty
  from grp
  group by keep_id
  having count(*) > 1
)
update public.deck_cards dc
   set quantity = least(t.total_qty, 10000)
  from totals t
 where dc.id = t.keep_id;

-- 2. Remove the non-survivors.
delete from public.deck_cards dc
 using (
   select
     dc2.id,
     row_number() over (
       partition by dc2.deck_id, c.oracle_id
       order by dc2.created_at, dc2.id
     ) as rn
   from public.deck_cards dc2
   join public.cards c on c.scryfall_id = dc2.card_id
   where c.oracle_id is not null
 ) ranked
 where dc.id = ranked.id
   and ranked.rn > 1;
