-- ---------------------------------------------------------------------------
-- Phase 4b/4c of the mobile initiative: an atomic MOVE, sibling to migration
-- 36's atomic stack ADDITION.
--
-- apply_stack_addition (migration 36) exists because quantity can appear from
-- nowhere -- a scan, an add form -- and two independent writers deciding "merge
-- to 4" off the same stale read must not both land on 4. Sleeving a card into
-- a deck, or pulling one back out, is a different and riskier shape: existing
-- physical copies change location_id, and the total across the whole
-- collection must never change. Losing an update while scanning loses a copy
-- that was just acquired; losing one half of a move can DESTROY copies that
-- were already owned -- a decrement with no matching increment, or the reverse,
-- split across two non-transactional statements. The web app's own
-- sleeveCopies/unsleeveCopies (src/app/(app)/decks/actions.ts) already have
-- exactly this defect and are left as-is for now (see .claude/rules/mobile.md)
-- -- this function is only for the new mobile write path, which has no
-- existing behaviour to preserve and every reason to be built correctly from
-- the start.
--
-- Shape, one transaction:
--   1. Ledger-first, identical idempotency discipline to apply_stack_addition:
--      insert into collection_write_ops on conflict (id) do nothing; a
--      conflict means this operation id was already recorded, so the call
--      compares fingerprints and either returns the recorded result (a genuine
--      replay) or raises (a reused id with different details).
--   2. Lock and re-verify the SOURCE row under `for update`: it must still be
--      this caller's, and still hold at least the quantity being moved. A
--      mismatch -- moved, edited, already spent by a concurrent move, no longer
--      owned -- raises rather than silently moving less than asked, or moving
--      from a row that is no longer what the caller decided against.
--   3. Decrement the source, or delete it outright when the move takes the
--      whole stack. Never delete-then-reinsert-elsewhere for a partial
--      remainder -- the row that stays behind keeps its id, acquired_at and
--      notes.
--   4. Apply the destination side with the same insert-or-merge shape as
--      migration 36: a caller-decided target id is re-verified against the
--      exact stack key (taken from the SOURCE row this function just locked,
--      not from a client-supplied card_id/condition/finish/language -- the
--      physical card does not change identity just because it changed box)
--      and atomically incremented; no target means a fresh row is inserted at
--      the destination, owned by the caller, carrying the source row's stack
--      attributes.
--
-- SECURITY INVOKER, not DEFINER, for the same reason migration 36 gives:
-- everything here is one user's own rows under their own RLS policies. There
-- is no owner parameter anywhere in this function's signature, and
-- owner_user_id is written only ever as auth.uid() -- never from an argument.
-- A move that could retarget ownership would be a second, unaudited transfer
-- path competing with accept_trade, which hard constraint 5 reserves that
-- territory to.
--
-- This is not a trade: no ownership_history row is written, because
-- ownership_user_id never changes on either row this function touches.
-- ---------------------------------------------------------------------------

alter table public.collection_write_ops
  drop constraint if exists collection_write_ops_kind_check;

alter table public.collection_write_ops
  add constraint collection_write_ops_kind_check
  check (kind in ('stack_add', 'stack_move'));

create or replace function public.apply_stack_move(
  p_operation_id                  uuid,
  p_source_instance_id            uuid,
  p_quantity                      integer,
  p_destination_location_id       uuid,
  p_destination_target_instance_id uuid
)
returns table (result_instance_id uuid, result_quantity integer, replayed boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_fingerprint   text;
  v_ledger        public.collection_write_ops;
  v_rowcount      integer;
  v_source        public.card_instances;
  v_instance_id   uuid;
  v_quantity      integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive integer' using errcode = 'invalid_parameter_value';
  end if;

  -- Per the migration header: source id, destination, target id and quantity
  -- -- not the stack's card_id/condition/finish/language, which this function
  -- reads off the locked source row itself rather than trusting a caller-
  -- supplied copy of them.
  v_fingerprint := concat_ws('|',
    p_source_instance_id::text,
    coalesce(p_destination_location_id::text, '<unsorted>'),
    coalesce(p_destination_target_instance_id::text, '<insert>'),
    p_quantity::text);

  -- Ledger-first, same transaction as the move below -- see migration 36's
  -- header for why ON CONFLICT DO NOTHING is safe against a genuinely
  -- concurrent second call with the same operation id, not just a sequential
  -- retry.
  insert into public.collection_write_ops (id, user_id, kind, fingerprint)
  values (p_operation_id, v_uid, 'stack_move', v_fingerprint)
  on conflict (id) do nothing;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 0 then
    select * into v_ledger from public.collection_write_ops where id = p_operation_id;

    if not found then
      -- Same reasoning as apply_stack_addition: RLS's "select own" hides a
      -- different account's row entirely, so this reads identically to "no
      -- such id" and leaks nothing about who actually holds it.
      raise exception 'This operation id is already in use'
        using errcode = 'unique_violation';
    end if;

    if v_ledger.fingerprint <> v_fingerprint then
      raise exception 'This operation was already submitted with different details'
        using errcode = 'invalid_parameter_value';
    end if;

    return query select v_ledger.result_instance_id, v_ledger.result_quantity, true;
    return;
  end if;

  -- Lock and re-verify the source under the row lock, not the caller's
  -- (necessarily stale) read: still this account's, still holding at least
  -- the quantity being moved. `owner_user_id = v_uid` here is written
  -- explicitly for the same "RLS is the floor, not the whole filter" reason
  -- .claude/rules/data-access.md documents for migration 36's merge lookup --
  -- redundant with the UPDATE policy today, independently load-bearing the
  -- moment that policy is ever widened.
  select * into v_source
    from public.card_instances
   where id = p_source_instance_id
     and owner_user_id = v_uid
     and quantity >= p_quantity
   for update;

  if not found then
    raise exception 'That source copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours'
      using errcode = 'no_data_found';
  end if;

  if v_source.quantity = p_quantity then
    -- The whole stack moves: delete rather than decrement-to-zero-then-insert,
    -- so a plain full-stack move never manufactures a phantom zero-quantity row.
    delete from public.card_instances where id = v_source.id;
  else
    update public.card_instances
       set quantity = quantity - p_quantity
     where id = v_source.id
       and owner_user_id = v_uid;
  end if;

  if p_destination_target_instance_id is not null then
    -- Merge branch: re-verify the exact stack key under the row lock. The
    -- stack key comes from v_source (the row just locked above), never from a
    -- client-supplied card_id/condition/finish/language -- the physical card's
    -- identity cannot change by virtue of moving box. `location_id is not
    -- distinct from`, not `=`: Unsorted (NULL) is a real destination value.
    perform 1
      from public.card_instances
     where id = p_destination_target_instance_id
       and owner_user_id = v_uid
       and card_id = v_source.card_id
       and condition = v_source.condition
       and finish = v_source.finish
       and language = v_source.language
       and location_id is not distinct from p_destination_location_id
       and coalesce(btrim(notes), '') = ''
     for update;

    if not found then
      raise exception 'That destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours'
        using errcode = 'no_data_found';
    end if;

    update public.card_instances
       set quantity = quantity + p_quantity
     where id = p_destination_target_instance_id
       and owner_user_id = v_uid
    returning id, quantity into v_instance_id, v_quantity;

    if not found then
      raise exception 'That destination stack could not be updated -- it may no longer be yours'
        using errcode = 'no_data_found';
    end if;
  else
    -- Insert branch: a fresh row at the destination, carrying the source
    -- row's stack attributes and notes. This still fires
    -- card_instances_enforce_location_owner (migration 5); let it -- a
    -- destination that is not this caller's own location should still refuse
    -- here exactly as it does on a plain insert.
    insert into public.card_instances
      (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
    values
      (v_uid, v_source.card_id, p_destination_location_id, v_source.condition,
       v_source.finish, v_source.language, p_quantity, v_source.notes)
    returning id, quantity into v_instance_id, v_quantity;
  end if;

  update public.collection_write_ops
     set result_instance_id = v_instance_id,
         result_quantity    = v_quantity
   where id = p_operation_id;

  return query select v_instance_id, v_quantity, false;
end;
$$;

revoke all on function public.apply_stack_move(
  uuid, uuid, integer, uuid, uuid
) from public;
grant execute on function public.apply_stack_move(
  uuid, uuid, integer, uuid, uuid
) to authenticated;
