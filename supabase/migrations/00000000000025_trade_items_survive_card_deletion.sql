-- ---------------------------------------------------------------------------
-- Deleting or moving a card should never be blocked by trade history.
--
-- trade_items.card_instance_id was ON DELETE RESTRICT, so deleting a
-- card_instance that had ever been part of ANY trade -- open, declined, or
-- completed years ago -- failed outright with a bare foreign-key error.
-- Discovered wiping a collection: two card_instances tied to one long-
-- completed trade could not be deleted.
--
-- The RESTRICT turns out to guard nothing:
--   - accept_trade() (migration 9) already SELECTs each instance FOR UPDATE
--     and raises its own "a card in this trade no longer exists" if it is
--     gone. It never relied on the FK to keep the instance alive.
--   - hydrateTrades() (src/lib/social/queries.ts) already tolerates a missing
--     instance -- it looks the id up in a Map and falls back to null.
--   - migration 23 snapshots card_id/finish onto the row specifically so a
--     trade item can describe a card whose instance is gone or hidden by RLS.
--
-- So trade_items can safely lose the live pointer: history stays complete
-- from its own snapshot, and the collection is free to change under it.
-- ---------------------------------------------------------------------------

alter table public.trade_items
  alter column card_instance_id drop not null;

alter table public.trade_items
  drop constraint trade_items_card_instance_id_fkey;

alter table public.trade_items
  add constraint trade_items_card_instance_id_fkey
    foreign key (card_instance_id) references public.card_instances (id)
    on delete set null;
