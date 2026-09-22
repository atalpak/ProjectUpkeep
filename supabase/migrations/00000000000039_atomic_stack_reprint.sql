-- ---------------------------------------------------------------------------
-- Changing which PRINTING an owned copy is, atomically -- the third sibling of
-- migration 36's stack addition and migration 38's stack move.
--
-- The need is ordinary: you scanned a card and the scanner picked the wrong
-- printing, or you always owned the Revised one and recorded the Beta. Until
-- now the only repair was delete-and-re-add, which throws away acquired_at and
-- is refused outright by trade_items' ON DELETE RESTRICT whenever the copy is
-- committed to an open trade.
--
-- Reprinting changes card_id, which is part of the stack key
-- (packages/upkeep-domain/src/stacking.ts). So it has exactly the shape of a
-- move -- one row loses copies, another may gain them -- except the axis is
-- the printing rather than the box. RLS permits a plain client-side update
-- (migration 5's "update own" policy pins owner_user_id in both USING and
-- WITH CHECK and says nothing about card_id), but a plain update cannot merge:
-- it would either leave a visible duplicate row next to an identical stack, or,
-- done as two statements, lose a copy under a concurrent writer.
--
--
-- WHY THE ORDER OF THE TWO SIDES IS LOAD-BEARING
--
-- card_instances_list_in_deck_on_quantity_change (migration 37) fires AFTER
-- UPDATE OF quantity. There is deliberately no trigger on UPDATE OF card_id,
-- so the in-place branch below fires nothing at all. The MERGE branch does
-- increment a quantity, though, and if that increment ran before the source
-- row gave its copies up, list_card_when_filed_in_deck() would see a physical
-- total inflated by p_quantity against an unchanged listed total, compute a
-- shortfall, and permanently raise deck_cards. That is precisely the migration
-- 20 corruption class, reached through a new write path. Hence: source side
-- first, always. The decrement itself is harmless because the trigger function
-- is monotone-up (migration 37's header spells this out).
--
-- Section 19 of supabase/tests/schema_test.sql exists to catch exactly this,
-- and was confirmed to fail with the two steps swapped before it was allowed
-- to pass.
--
--
-- WHY A REPRINT WITH NO MERGE TARGET UPDATES IN PLACE
--
-- This is the one genuine divergence from apply_stack_move, which always
-- inserts at the destination. Here the card did not go anywhere: it is the
-- same physical object, still in the same box, and it is only our record of
-- which printing it is that was wrong. Delete-and-reinsert would lose
-- acquired_at and break the trade_items foreign key that points at this exact
-- row. So a whole-stack reprint with nothing to merge into is an UPDATE of
-- card_id and finish, and the row keeps its id -- which the caller can rely on
-- and which section 19 asserts.
--
--
-- WHY AN OPEN TRADE BLOCKS IT
--
-- accept_trade transfers v_instance.card_id as read at ACCEPT time, not from
-- the snapshot migration 23 takes when the offer is made. So without this gate
-- an in-place reprint silently changes what the counterparty receives, while
-- the trade screen keeps showing them the printing they actually agreed to.
-- trade_items' ON DELETE RESTRICT is a second floor for the merge branch only
-- (it deletes the source row); the in-place branch has no protection at all
-- from it. Do not relax this gate as over-caution -- it is the only thing
-- standing between a collection tidy-up and handing someone a different card
-- than they agreed to.
--
-- The gate's predicate matches accept_trade's own live checks (migration 13):
-- status = 'proposed', and not past expires_at. Migration 13 narrowed migration
-- 9's refusal to `status <> 'proposed'`, so 'countered' is genuinely terminal
-- and does not need blocking here. Expiry has no sweeper job -- it is a derived
-- fact -- so it must be evaluated in the predicate rather than assumed.
--
-- Note that under SECURITY INVOKER this gate depends on RLS visibility: the
-- caller's own "read own trades" / "read own trade items" policies (migration
-- 9) make every relevant row visible, because any trade containing my instance
-- is a trade where I am proposer or recipient. That holds today. If those
-- policies are ever narrowed, this gate degrades to "allow" rather than failing
-- closed, so narrow them with this function in hand.
--
--
-- WHY NO ownership_history ROW
--
-- Same reason migration 38 gives, and then four more. owner_user_id never
-- changes here, so nothing was transferred. ownership_history has a select
-- policy but NO insert policy at all (migration 9: "Inserts come only from
-- accept_trade()"), so writing one would force this function to SECURITY
-- DEFINER and walk straight into hard constraint 5. Its select policy is also
-- readable by accepted friends, so every correction you made to your own
-- collection would become a social event. Its shape rejects the semantics
-- anyway (to_user_id is NOT NULL and from_user_id IS NULL means "newly
-- created", so from = to is a lie about what the table records). And
-- ownership_history_is_append_only (migration 6) refuses UPDATE and DELETE for
-- every role including the table owner, so a wrong row would be permanent.
--
-- The audit already exists, at the right sensitivity, for free:
-- collection_write_ops with kind = 'stack_reprint'. It is per-user,
-- own-row-only under RLS, immutable, already enrolled in delete_own_account's
-- cascade, and its fingerprint already names the source instance, the new
-- printing, the finish, the target and the quantity.
--
--
-- The stacking POLICY is not decided here. Whether two identical copies
-- collapse into one row lives in TypeScript (STACKING_ENABLED), and this
-- function only carries out an instruction the caller already decided --
-- p_target_instance_id null means "do not merge". That is what keeps the
-- stacking bet reversible, and it is the single most important constraint to
-- hold while extending this family of functions.
-- ---------------------------------------------------------------------------

alter table public.collection_write_ops
  drop constraint if exists collection_write_ops_kind_check;

alter table public.collection_write_ops
  add constraint collection_write_ops_kind_check
  check (kind in ('stack_add', 'stack_move', 'stack_reprint'));

create or replace function public.apply_stack_reprint(
  p_operation_id       uuid,
  p_instance_id        uuid,
  p_new_card_id        uuid,
  p_finish             text,
  p_target_instance_id uuid,
  p_quantity           integer
)
returns table (result_instance_id uuid, result_quantity integer, replayed boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_fingerprint  text;
  v_ledger       public.collection_write_ops;
  v_rowcount     integer;
  v_source       public.card_instances;
  v_old_card     public.cards;
  v_new_card     public.cards;
  v_same_card    boolean;
  v_open_trades  integer;
  v_instance_id  uuid;
  v_quantity     integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive integer' using errcode = 'invalid_parameter_value';
  end if;

  -- A caller that passed the source row as its own merge target would have
  -- this function delete the row and then increment it. Refuse outright rather
  -- than discover it halfway through.
  if p_target_instance_id is not null and p_target_instance_id = p_instance_id then
    raise exception 'A copy cannot be merged into itself'
      using errcode = 'invalid_parameter_value';
  end if;

  v_fingerprint := concat_ws('|',
    p_instance_id::text,
    p_new_card_id::text,
    p_finish,
    coalesce(p_target_instance_id::text, '<insert>'),
    p_quantity::text);

  -- Ledger-first, same transaction as the work below. See migration 36's
  -- header for why ON CONFLICT DO NOTHING is safe against a genuinely
  -- concurrent second call with the same operation id, not merely a retry.
  insert into public.collection_write_ops (id, user_id, kind, fingerprint)
  values (p_operation_id, v_uid, 'stack_reprint', v_fingerprint)
  on conflict (id) do nothing;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 0 then
    select * into v_ledger from public.collection_write_ops where id = p_operation_id;

    if not found then
      -- RLS's "select own" hides another account's row entirely, so this reads
      -- identically to "no such id" and leaks nothing about who holds it.
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

  -- Lock and re-verify the source against the row lock rather than the
  -- caller's necessarily stale read. `owner_user_id = v_uid` is written
  -- explicitly for the "RLS is the floor, not the whole filter" reason
  -- .claude/rules/data-access.md documents at length: redundant with today's
  -- UPDATE policy, independently load-bearing the moment that policy widens.
  select * into v_source
    from public.card_instances
   where id = p_instance_id
     and owner_user_id = v_uid
     and quantity >= p_quantity
   for update;

  if not found then
    raise exception 'That copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours'
      using errcode = 'no_data_found';
  end if;

  select * into v_old_card from public.cards where scryfall_id = v_source.card_id;
  select * into v_new_card from public.cards where scryfall_id = p_new_card_id;

  if v_new_card is null then
    raise exception 'That printing is not in the card database'
      using errcode = 'no_data_found';
  end if;

  -- The same-card rule, enforced in SQL and not only in the server action, so
  -- a second client cannot bypass it. Same rule setDeckCardPrinting applies in
  -- TypeScript: oracle_id when both sides have one, falling back to the name
  -- when either does not.
  v_same_card := case
    when v_old_card.oracle_id is not null and v_new_card.oracle_id is not null
      then v_old_card.oracle_id = v_new_card.oracle_id
    else lower(v_old_card.name) = lower(v_new_card.name)
  end;

  if not v_same_card then
    raise exception 'A copy can only be changed to another printing of the same card'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Refusing an impossible finish here, rather than quietly keeping the old
  -- one, is what makes "warn and force a choice" a rule instead of a
  -- suggestion: a caller that skipped the warning gets an error, not a foil
  -- recorded against a printing that was never foiled.
  if p_finish is null or not (p_finish = any (coalesce(v_new_card.available_finishes, '{}'))) then
    raise exception 'That printing does not come in %', coalesce(p_finish, 'that finish')
      using errcode = 'invalid_parameter_value';
  end if;

  -- The open-trade gate. See the header: without it, accept_trade would hand
  -- the counterparty a printing they never agreed to.
  select count(*) into v_open_trades
    from public.trade_items ti
    join public.trades t on t.id = ti.trade_id
   where ti.card_instance_id = v_source.id
     and t.status = 'proposed'
     and (t.expires_at is null or t.expires_at > now());

  if v_open_trades > 0 then
    raise exception 'This copy is in an open trade offer -- cancel or complete the trade first'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_target_instance_id is not null then
    -- MERGE BRANCH. Source side first -- see the header. Reversing these two
    -- statements inflates deck_cards permanently.
    if v_source.quantity = p_quantity then
      delete from public.card_instances where id = v_source.id;
    else
      update public.card_instances
         set quantity = quantity - p_quantity
       where id = v_source.id
         and owner_user_id = v_uid;
    end if;

    -- Re-verify the full POST-reprint stack key under the row lock. card_id
    -- and finish come from the arguments (they are what is changing);
    -- condition, language and location come off the locked source row, because
    -- a reprint does not alter any of them. `is not distinct from`, not `=`:
    -- Unsorted (NULL) is a real location value.
    perform 1
      from public.card_instances
     where id = p_target_instance_id
       and owner_user_id = v_uid
       and card_id = p_new_card_id
       and condition = v_source.condition
       and finish = p_finish
       and language = v_source.language
       and location_id is not distinct from v_source.location_id
       and coalesce(btrim(notes), '') = ''
     for update;

    if not found then
      raise exception 'That destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours'
        using errcode = 'no_data_found';
    end if;

    update public.card_instances
       set quantity = quantity + p_quantity
     where id = p_target_instance_id
       and owner_user_id = v_uid
    returning id, quantity into v_instance_id, v_quantity;

    if not found then
      raise exception 'That destination stack could not be updated -- it may no longer be yours'
        using errcode = 'no_data_found';
    end if;

  elsif v_source.quantity = p_quantity then
    -- IN-PLACE BRANCH. The whole stack is the same physical cards; only our
    -- record of the printing was wrong. Update rather than reinsert, so the
    -- row keeps its id, acquired_at, notes and any trade_items pointing at it.
    -- This fires no trigger: quantity is untouched and so is location_id.
    update public.card_instances
       set card_id = p_new_card_id,
           finish  = p_finish
     where id = v_source.id
       and owner_user_id = v_uid
    returning id, quantity into v_instance_id, v_quantity;

    if not found then
      raise exception 'That copy could not be updated -- it may no longer be yours'
        using errcode = 'no_data_found';
    end if;

  else
    -- SPLIT BRANCH: part of a stack turns out to be a different printing, and
    -- there is nothing to merge it into. Decrement first, same ordering rule
    -- as the merge branch, then insert the reprinted portion beside it
    -- carrying every stack attribute the reprint does not change.
    update public.card_instances
       set quantity = quantity - p_quantity
     where id = v_source.id
       and owner_user_id = v_uid;

    insert into public.card_instances
      (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
    values
      (v_uid, p_new_card_id, v_source.location_id, v_source.condition,
       p_finish, v_source.language, p_quantity, v_source.notes)
    returning id, quantity into v_instance_id, v_quantity;
  end if;

  update public.collection_write_ops
     set result_instance_id = v_instance_id,
         result_quantity    = v_quantity
   where id = p_operation_id;

  return query select v_instance_id, v_quantity, false;
end;
$$;

revoke all on function public.apply_stack_reprint(
  uuid, uuid, uuid, text, uuid, integer
) from public;
grant execute on function public.apply_stack_reprint(
  uuid, uuid, uuid, text, uuid, integer
) to authenticated;
