-- ---------------------------------------------------------------------------
-- A trade item remembers which language it was, too.
--
-- Backlog item 8 step 2. Migration 23 already snapshots a trade_item's card
-- and finish, because once a trade completes accept_trade() moves the
-- underlying card_instance to the other owner and RLS then hides it from the
-- person who gave it away — their own trade history would otherwise show "a
-- card" instead of the card it actually was. A copy's language is exactly the
-- same kind of fact: it lives on card_instances, not on cards, so it is lost
-- the same way once the instance is gone. Add it to the same snapshot rather
-- than inventing a second mechanism.
-- ---------------------------------------------------------------------------

alter table public.trade_items
  add column if not exists language text;

-- Backfill from instances that are still around, the same join migration 23
-- uses for card_id/finish.
update public.trade_items ti
   set language = ci.language
  from public.card_instances ci
 where ci.id = ti.card_instance_id
   and ti.language is null;

create or replace function public.snapshot_trade_item_card()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.card_id is null then
    select ci.card_id, ci.finish, ci.language
      into new.card_id, new.finish, new.language
      from public.card_instances ci
     where ci.id = new.card_instance_id;
  end if;
  return new;
end;
$$;
