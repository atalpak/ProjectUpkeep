-- ---------------------------------------------------------------------------
-- A deck's list follows what is physically in it.
--
-- Until now `deck_cards` (the intended list) and the card_instances filed into
-- a deck (what is sleeved) were kept in step only by the "Add to list" button
-- and the one-off backfill in migration 10. Every other way a card reaches a
-- deck — the importer, the add-card form, a bulk move, "add from collection" —
-- filed the physical copy and left the list alone, so the deck page showed the
-- card under "in the deck but not on the list" instead of as a normal, sleeved
-- entry.
--
-- The rule the product actually wants is simpler: anything physically in a deck
-- is on that deck's list. This makes it true with a trigger, so no code path
-- can forget, and backfills the decks that already drifted.
--
-- The reverse direction — removing a list entry also pulls its sleeved copies
-- out of the box — is handled in the app (removeDeckCard), because "which
-- physical copies" is a per-printing question the app already answers there.
-- ---------------------------------------------------------------------------

create or replace function public.list_card_when_filed_in_deck()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_deck  boolean;
  v_physical integer;
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

  -- Every copy of this printing now physically in this deck. AFTER trigger, so
  -- NEW is already counted.
  select coalesce(sum(ci.quantity), 0)
    into v_physical
    from public.card_instances ci
   where ci.location_id = new.location_id
     and ci.card_id = new.card_id;

  -- Create the list entry, or raise its quantity to cover what is sleeved —
  -- never lower it, so an aspirational "want 4, own 1" stays 4.
  insert into public.deck_cards (deck_id, card_id, quantity)
  values (new.location_id, new.card_id, greatest(v_physical, 1))
  on conflict (deck_id, card_id) do update
    set quantity   = greatest(deck_cards.quantity, excluded.quantity),
        updated_at = now();

  return null;
end;
$$;

drop trigger if exists card_instances_list_in_deck_on_insert on public.card_instances;
create trigger card_instances_list_in_deck_on_insert
  after insert on public.card_instances
  for each row execute function public.list_card_when_filed_in_deck();

drop trigger if exists card_instances_list_in_deck_on_move on public.card_instances;
create trigger card_instances_list_in_deck_on_move
  after update of location_id on public.card_instances
  for each row
  when (new.location_id is distinct from old.location_id)
  execute function public.list_card_when_filed_in_deck();

-- ---------------------------------------------------------------------------
-- Backfill: every card sitting in a deck box becomes a list entry.
--
-- Same shape as migration 10's backfill, run again to catch everything filed
-- since. `do update ... greatest` rather than `do nothing` so a deck that
-- already has a partial list gains the missing entries without losing an
-- aspirational quantity on the ones it has.
-- ---------------------------------------------------------------------------

insert into public.deck_cards (deck_id, card_id, quantity)
select ci.location_id, ci.card_id, sum(ci.quantity)
  from public.card_instances ci
  join public.locations l on l.id = ci.location_id
 where l.type = 'deck'
 group by ci.location_id, ci.card_id
on conflict (deck_id, card_id) do update
  set quantity   = greatest(deck_cards.quantity, excluded.quantity),
      updated_at = now();
