-- ---------------------------------------------------------------------------
-- A trade item remembers which card it was.
--
-- trade_items point at a card_instance. Once a trade completes, accept_trade()
-- moves that instance to the other owner (or splits and deletes it), and RLS
-- then hides it from the person who gave it away — so their own past trade
-- shows "a card" instead of the card's name.
--
-- Snapshot the card (and its finish) onto the trade_item when it is added, from
-- the cards table, which never moves and is world-readable. A BEFORE INSERT
-- trigger fills it so every code path that adds an item is covered, and a
-- one-off backfill catches the instances that still exist.
-- ---------------------------------------------------------------------------

alter table public.trade_items
  add column if not exists card_id uuid references public.cards (scryfall_id),
  add column if not exists finish  text;

-- Backfill from instances that are still around. This migration runs as the
-- table owner, so RLS does not hide the moved ones.
update public.trade_items ti
   set card_id = ci.card_id,
       finish  = ci.finish
  from public.card_instances ci
 where ci.id = ti.card_instance_id
   and ti.card_id is null;

create or replace function public.snapshot_trade_item_card()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.card_id is null then
    select ci.card_id, ci.finish
      into new.card_id, new.finish
      from public.card_instances ci
     where ci.id = new.card_instance_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trade_items_snapshot_card on public.trade_items;
create trigger trade_items_snapshot_card
  before insert on public.trade_items
  for each row execute function public.snapshot_trade_item_card();
