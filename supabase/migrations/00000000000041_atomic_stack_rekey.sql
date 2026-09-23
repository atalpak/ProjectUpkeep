-- ---------------------------------------------------------------------------
-- One atomic re-file for an arbitrary list of steps -- the fourth sibling of
-- migration 36's addition, 38's move and 39's reprint, and the fix for the
-- architect impact map recorded under backlog item 2, 2026-09-22
-- (apps/mobile/docs/BACKLOG.md).
--
-- THE PROBLEM THIS REPLACES
--
-- The web app has five different write paths that change a copy's condition,
-- finish, language or location and may need to merge into an existing pile:
-- updateCardInstance, bulkMove, bulkSetField, sleeve/unsleeve, and bulkMerge.
-- None of them is atomic. Each does a read, a decision, then one or more
-- separate UPDATE/DELETE statements -- so a lost half of that sequence either
-- duplicates a row (updateCardInstance editing onto an existing stack) or,
-- worse, makes copies vanish (unsleeveCopies and removeEntryFromList swallow
-- their own write errors outright). Patching each path individually was
-- considered and rejected: a bulk action can touch up to 5,000 rows
-- (MAX_BULK_IDS), and a one-row-per-RPC-call shape would mean up to ~10,000
-- sequential round trips for one bulk operation -- more than enough to time
-- out on Vercel. One function taking an ORDERED LIST of steps, one
-- transaction, all-or-nothing, is the shape that scales: a caller collects
-- every row it intends to touch, decides each one's destination the same way
-- the edit form or bulk actions already do, and submits the whole list once.
--
-- Every step re-files exactly one existing pile (or part of one) to a new
-- condition/finish/language/location, and may optionally decide to merge the
-- moved copies into an existing pile that already holds those exact
-- attributes. Unlike apply_stack_reprint, a rekey never changes card_id --
-- changing which PRINTING a copy is stays that function's job alone. That
-- keeps this function's merge check simpler than reprint's: the target must
-- match the SOURCE row's own card_id, not a caller-supplied new one.
--
--
-- WHY THE STEPS RUN AS ONE TRANSACTION, AND WHY NOTHING HERE CATCHES ITS OWN
-- EXCEPTIONS
--
-- Postgres functions are already transactional -- an uncaught exception
-- anywhere in the loop below aborts the whole call, which rolls back every
-- step already applied earlier in the SAME list, and the ledger row this
-- function inserted first. That is what makes "all or nothing" true with no
-- extra bookkeeping: the owner's sign-off is explicit that a stale step
-- anywhere in the list must abort the entire list, not just itself, and nothing
-- in this function wraps a step in its own BEGIN/EXCEPTION block to recover
-- and continue -- doing that would silently turn "all or nothing" into
-- "whatever happened to succeed," the exact failure mode bulkMerge's own
-- two-request sequence already has today.
--
-- Steps also see each other's effects, in order, because each one takes its
-- own `select ... for update` against the CURRENT state of the row, not a
-- snapshot taken before the loop started. A later step can merge into a row
-- an earlier step in the same list only just re-filed, or can be stopped cold
-- because an earlier step already spent the row it names.
--
--
-- WHY MERGE CLEARS THE SOURCE BEFORE INCREMENTING THE TARGET
--
-- Identical hazard to migration 39's header, reached through a new door.
-- card_instances_list_in_deck_on_quantity_change (migration 37) fires on
-- every quantity UPDATE. If the target's increment ran before the source
-- gave its copies up, the trigger would see a physical total temporarily
-- inflated by the moved quantity against an unchanged listed total, add a
-- shortfall, and permanently raise deck_cards -- the migration 20 corruption
-- class. Source side first, always; the decrement itself is harmless because
-- the trigger function is monotone-up (migration 37's header).
--
-- The new schema_test.sql section mirrors section 19's discipline exactly:
-- confirmed to fail with the two sides of the merge branch swapped, before
-- being allowed to pass with the correct order restored.
--
--
-- WHY KEEP-THE-ROW UPDATES IN PLACE, AND WHY THAT MATTERS MORE HERE THAN IT
-- DID FOR apply_stack_move
--
-- A step with no merge target whose quantity equals the source row's current
-- quantity is not moving anything into or out of a stack -- it is the same
-- physical pile, only some of its attributes were wrong (or a whole pile is
-- being re-filed to a new box). UPDATE in place, not delete-and-reinsert:
-- the row keeps its id, its acquired_at, and any trade_items row that still
-- points at it.
--
-- apply_stack_move (migration 38) does NOT do this -- its whole-pile,
-- no-merge-target branch always inserts a fresh row at the destination,
-- because a move's whole point is that the card physically left one place
-- for another, so a new row there was never actually wrong. But the
-- architect's impact map flagged that same shape as a bug when it happens
-- through the paths this function replaces: an edit-form re-file with no
-- merge target is not a move, it is "this row's own attributes were mis-
-- recorded," and giving it a new id (and a fresh acquired_at, and severing
-- any open trade's pointer) makes it read as a card that was just newly
-- acquired days after it actually was. apply_stack_reprint already reached
-- this same conclusion for its own no-merge-target branch, for the same
-- reason, and this function matches it rather than apply_stack_move. The
-- open mobile bug this leaves in apply_stack_move itself is logged in the
-- backlog rather than fixed here -- out of scope for this migration.
--
--
-- WHY THE FINISH CHECK ONLY FIRES WHEN THE FINISH IS ACTUALLY CHANGING
--
-- Owner decision, 2026-09-22, settled: the edit form already lets someone
-- keep a copy's existing finish untouched even when the catalog's
-- available_finishes looks wrong for it (bad or incomplete Scryfall data is
-- not this owner's problem to solve by refusing an otherwise-harmless edit).
-- Checking the finish unconditionally, the way apply_stack_reprint does,
-- would break that -- reprint gets to check unconditionally because IT is
-- what's introducing the new card_id/finish pairing in the first place, and
-- there is no such thing as "the finish that was already fine" on that path.
-- Here, a step whose finish equals the source row's current finish skips the
-- check entirely; a step that changes it is checked against the row's
-- EXISTING card_id's available_finishes, because this function never changes
-- card_id.
--
--
-- WHY THE OPEN-TRADE GATE COVERS MERGE AND SPLIT ALWAYS, AND KEEP-THE-ROW
-- ONLY WHEN FINISH CHANGES
--
-- Owner decision, 2026-09-22, revised same day after the first pass proposed
-- exempting KEEP-THE-ROW entirely: `accept_trade` reads a copy's FINISH live
-- off the row at accept time, not from migration 23's snapshot -- the exact
-- same live-read fact that makes `apply_stack_reprint` gate its own in-place
-- branch, even though that branch (like KEEP-THE-ROW here) never changes the
-- row's id. A finish correction on a traded copy hands the counterparty a
-- different finish than the trade screen showed them; that risk does not
-- care whether the row also changed identity. So: MERGE and SPLIT are always
-- gated (they change which ROW physically represents the traded copies -- a
-- merge deletes or shrinks the source outright, a split leaves part of the
-- pile behind under a fresh id -- a bigger disruption on top of the same
-- live-read risk). KEEP-THE-ROW is gated too, but only when the step's
-- finish differs from the source row's current finish; a condition,
-- language, location or notes-only edit stays ungated, because none of
-- those are read live by `accept_trade` and blocking them would refuse
-- edits a live trade has no stake in.
--
--
-- CORRECTING MIGRATION 39'S HEADER
--
-- Migration 39 describes the pre-migration state of trade_items.card_instance_id
-- as "ON DELETE RESTRICT". That was true when migration 36 first built this
-- family of functions, but migration 25 (trade_items_survive_card_deletion)
-- already changed it to ON DELETE SET NULL before migration 39 was ever
-- written -- so a merge or move of a traded copy can already orphan that
-- trade's item with no warning, and has been able to since migration 25.
-- Migration 39 cannot be edited to fix this (hard constraint 8); this is
-- where the correction is recorded for a future reader who trusts that
-- header at face value.
--
--
-- THE LEDGER GAINS A COLUMN, BECAUSE THIS FUNCTION RETURNS A LIST
--
-- Every existing kind of collection_write_ops row describes one instance's
-- one outcome, so result_instance_id/result_quantity (migration 36) were
-- enough. A rekey call can touch dozens of rows in one call, so a replay
-- needs to hand back every step's result, not one. result_steps is a nullable
-- jsonb column -- a JSON array of {step_index, result_instance_id,
-- result_quantity} -- left null for every other kind, and protected by the
-- same immutability trigger (migration 36) as the two columns it joins: once
-- recorded, never rewritten.
--
--
-- The stacking POLICY is still not decided here, same as every sibling:
-- p_target_instance_id null on a step means "do not merge that step,"
-- exactly as it does for apply_stack_addition/move/reprint. CLAUDE.md's "two
-- reversible bets" stays intact.
--
-- SECURITY INVOKER, not DEFINER, for the same reason as every sibling: this
-- function only ever reads/locks/writes rows the caller's own RLS policies
-- already let them touch, plus its own ledger row. No owner parameter
-- anywhere -- owner_user_id is always auth.uid(), and a card can only ever be
-- inserted or re-filed into a location the trigger
-- card_instances_enforce_location_owner (migration 5) confirms is the
-- caller's own.
-- ---------------------------------------------------------------------------

alter table public.collection_write_ops
  drop constraint if exists collection_write_ops_kind_check;

alter table public.collection_write_ops
  add constraint collection_write_ops_kind_check
  check (kind in ('stack_add', 'stack_move', 'stack_reprint', 'stack_rekey'));

alter table public.collection_write_ops
  add column if not exists result_steps jsonb;

comment on column public.collection_write_ops.result_steps is
  $$Per-step results for a 'stack_rekey' operation (a JSON array of
{step_index, result_instance_id, result_quantity}), left null for every other
kind. result_instance_id/result_quantity (migration 36) hold one outcome each
and are not enough for a call that can carry dozens of steps.$$;

-- Re-created (not edited -- migration 36's file is untouched) to also protect
-- result_steps once it has been recorded, the same way it already protects
-- result_instance_id and result_quantity.
create or replace function public.enforce_write_op_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.fingerprint is distinct from old.fingerprint then
    raise exception 'collection_write_ops: id, user_id, kind and fingerprint are immutable'
      using errcode = 'insufficient_privilege';
  end if;

  if (old.result_instance_id is not null and new.result_instance_id is distinct from old.result_instance_id)
     or (old.result_quantity is not null and new.result_quantity is distinct from old.result_quantity)
     or (old.result_steps is not null and new.result_steps is distinct from old.result_steps) then
    raise exception 'collection_write_ops: result cannot be changed once recorded'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create or replace function public.apply_stack_rekey(
  p_operation_id uuid,
  p_steps        jsonb
)
returns table (step_index integer, result_instance_id uuid, result_quantity integer, replayed boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_fingerprint  text;
  v_ledger       public.collection_write_ops;
  v_rowcount     integer;
  v_results      jsonb := '[]'::jsonb;
  v_rec          record;
  v_idx          integer;
  v_step         jsonb;
  v_instance_id  uuid;
  v_quantity     integer;
  v_condition    text;
  v_finish       text;
  v_language     text;
  v_location_id  uuid;
  v_notes        text;
  v_target_id    uuid;
  v_source       public.card_instances;
  v_card         public.cards;
  v_open_trades  integer;
  v_is_keep      boolean;
  v_result_id    uuid;
  v_result_qty   integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'p_steps must be a non-empty JSON array of steps'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Canonical, order-sensitive fingerprint over every field each step's
  -- decision was made from -- built field by field, like every sibling
  -- function's fingerprint, rather than trusting jsonb's own text
  -- serialisation, whose object-key order merely follows how the caller
  -- happened to build the value.
  select string_agg(
           concat_ws('|',
             coalesce(step->>'instance_id', '<null>'),
             coalesce(step->>'quantity', '<null>'),
             coalesce(step->>'condition', '<null>'),
             coalesce(step->>'finish', '<null>'),
             coalesce(step->>'language', '<null>'),
             coalesce(step->>'location_id', '<unsorted>'),
             coalesce(step->>'notes', ''),
             coalesce(step->>'target_instance_id', '<insert>')
           ),
           '||' order by ord)
    into v_fingerprint
    from jsonb_array_elements(p_steps) with ordinality as t(step, ord);

  -- Ledger-first, same transaction as the steps below -- see migration 36's
  -- header for why ON CONFLICT DO NOTHING is safe against a genuinely
  -- concurrent second call with the same operation id, not just a sequential
  -- retry.
  insert into public.collection_write_ops (id, user_id, kind, fingerprint)
  values (p_operation_id, v_uid, 'stack_rekey', v_fingerprint)
  on conflict (id) do nothing;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 0 then
    select * into v_ledger from public.collection_write_ops where id = p_operation_id;

    if not found then
      -- RLS's "select own" hides another account's row entirely, so this
      -- reads identically to "no such id" and leaks nothing about who holds
      -- it.
      raise exception 'This operation id is already in use'
        using errcode = 'unique_violation';
    end if;

    if v_ledger.fingerprint <> v_fingerprint then
      raise exception 'This operation was already submitted with different details'
        using errcode = 'invalid_parameter_value';
    end if;

    return query
      select (elem->>'step_index')::integer,
             (elem->>'result_instance_id')::uuid,
             (elem->>'result_quantity')::integer,
             true
        from jsonb_array_elements(v_ledger.result_steps) as elem
       order by (elem->>'step_index')::integer;
    return;
  end if;

  for v_rec in
    select step, ord from jsonb_array_elements(p_steps) with ordinality as t(step, ord) order by ord
  loop
    v_step        := v_rec.step;
    v_idx         := v_rec.ord::integer - 1;
    v_instance_id := (v_step->>'instance_id')::uuid;
    v_quantity    := (v_step->>'quantity')::integer;
    v_condition   := v_step->>'condition';
    v_finish      := v_step->>'finish';
    v_language    := v_step->>'language';
    v_location_id := (v_step->>'location_id')::uuid;
    v_notes       := v_step->>'notes';
    v_target_id   := (v_step->>'target_instance_id')::uuid;

    if v_instance_id is null then
      raise exception 'step %: instance_id is required', v_idx
        using errcode = 'invalid_parameter_value';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'step %: quantity must be a positive integer', v_idx
        using errcode = 'invalid_parameter_value';
    end if;

    -- Same guard apply_stack_reprint opens with: a step that would delete its
    -- own row and then increment it.
    if v_target_id is not null and v_target_id = v_instance_id then
      raise exception 'step %: a copy cannot be merged into itself', v_idx
        using errcode = 'invalid_parameter_value';
    end if;

    -- Lock and re-verify the source under the row lock -- not the caller's
    -- necessarily stale read, and not even this call's OWN earlier read of
    -- the same id: an earlier step in this very list may already have
    -- changed or removed this row, which must abort the entire list, not
    -- just this step. `owner_user_id = v_uid` is written explicitly for the
    -- same "RLS is the floor, not the whole filter" reason every sibling
    -- function writes it (.claude/rules/data-access.md).
    select * into v_source
      from public.card_instances
     where id = v_instance_id
       and owner_user_id = v_uid
       and quantity >= v_quantity
     for update;

    if not found then
      raise exception 'step %: that copy no longer matches what was decided -- it may have moved, been edited, changed quantity, already been spent by an earlier step in this same list, or no longer be yours', v_idx
        using errcode = 'no_data_found';
    end if;

    -- Finish check, only when the finish is actually changing -- see the
    -- header. A step that leaves finish untouched is never blocked here,
    -- even against odd catalog data, matching the edit form's own rule. This
    -- function never changes card_id, so the check is always against the
    -- row's EXISTING printing.
    if v_finish is distinct from v_source.finish then
      select * into v_card from public.cards where scryfall_id = v_source.card_id;

      if v_finish is null or not (v_finish = any (coalesce(v_card.available_finishes, '{}'))) then
        raise exception 'step %: that printing does not come in %', v_idx, coalesce(v_finish, 'that finish')
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    v_is_keep := (v_target_id is null and v_source.quantity = v_quantity);

    -- The open-trade gate. MERGE and SPLIT always -- see the header. KEEP-
    -- THE-ROW only when finish is actually changing: accept_trade reads
    -- finish live off the row at accept time, so a finish correction on a
    -- traded copy has the exact same silent-substitution risk
    -- apply_stack_reprint's in-place branch is gated against, even though
    -- KEEP does not touch card_id or the row's identity. Condition/language/
    -- location/notes-only edits stay ungated: none of those change what
    -- accept_trade hands the counterparty. Predicate matches accept_trade's
    -- own live checks (migration 13), same shape as apply_stack_reprint's gate.
    if not v_is_keep or v_finish is distinct from v_source.finish then
      select count(*) into v_open_trades
        from public.trade_items ti
        join public.trades t on t.id = ti.trade_id
       where ti.card_instance_id = v_source.id
         and t.status = 'proposed'
         and (t.expires_at is null or t.expires_at > now());

      if v_open_trades > 0 then
        raise exception 'step %: this copy is in an open trade offer -- cancel or complete the trade first', v_idx
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    if v_target_id is not null then
      -- MERGE. Source side first -- see the header: reversing this and the
      -- target increment inflates deck_cards permanently via migration 37's
      -- trigger.
      if v_source.quantity = v_quantity then
        delete from public.card_instances where id = v_source.id;
      else
        update public.card_instances
           set quantity = quantity - v_quantity
         where id = v_source.id
           and owner_user_id = v_uid;
      end if;

      -- Re-verify the full POST-rekey stack key under the row lock. card_id
      -- never changes here (that is apply_stack_reprint's territory alone),
      -- so it comes off the locked source row; condition/finish/language/
      -- location come off this step's own decided values. `is not distinct
      -- from`, not `=`: Unsorted (NULL) is a real location value. The
      -- blank-notes clause is what refuses a target carrying a note --
      -- decideStacking's rule that only an un-annotated row ever merges --
      -- and it is also what refuses a stale target whose note changed
      -- underneath the decision, both surfacing as the same "no longer
      -- matches" refusal every sibling function gives for this case.
      perform 1
        from public.card_instances
       where id = v_target_id
         and owner_user_id = v_uid
         and card_id = v_source.card_id
         and condition = v_condition
         and finish = v_finish
         and language = v_language
         and location_id is not distinct from v_location_id
         and coalesce(btrim(notes), '') = ''
       for update;

      if not found then
        raise exception 'step %: that destination stack no longer matches the decided target -- it may have moved, been edited, carry a note, or no longer be yours', v_idx
          using errcode = 'no_data_found';
      end if;

      update public.card_instances
         set quantity = quantity + v_quantity
       where id = v_target_id
         and owner_user_id = v_uid
      returning id, quantity into v_result_id, v_result_qty;

      if not found then
        raise exception 'step %: that destination stack could not be updated -- it may no longer be yours', v_idx
          using errcode = 'no_data_found';
      end if;

    elsif v_is_keep then
      -- KEEP THE ROW. The whole pile is re-filed in place: same id,
      -- acquired_at, and any trade_items row still pointing at it. This is
      -- the deliberate divergence from apply_stack_move's whole-pile-no-
      -- merge branch (which always inserts a fresh row) -- see the header.
      -- This still fires card_instances_enforce_location_owner (migration 5)
      -- on the location_id column, exactly as a plain update would; let it --
      -- a location that is not this caller's own should still refuse here.
      update public.card_instances
         set condition   = v_condition,
             finish      = v_finish,
             language    = v_language,
             location_id = v_location_id,
             notes       = v_notes
       where id = v_source.id
         and owner_user_id = v_uid
      returning id, quantity into v_result_id, v_result_qty;

      if not found then
        raise exception 'step %: that copy could not be updated -- it may no longer be yours', v_idx
          using errcode = 'no_data_found';
      end if;

    else
      -- SPLIT. Part of a pile is re-filed differently and there is nothing to
      -- merge it into. Decrement first, same ordering rule as the merge
      -- branch, then insert the re-filed portion carrying this step's
      -- values. This still fires card_instances_enforce_location_owner on
      -- insert, exactly as a plain insert would.
      update public.card_instances
         set quantity = quantity - v_quantity
       where id = v_source.id
         and owner_user_id = v_uid;

      insert into public.card_instances
        (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
      values
        (v_uid, v_source.card_id, v_location_id, v_condition, v_finish, v_language, v_quantity, v_notes)
      returning id, quantity into v_result_id, v_result_qty;
    end if;

    v_results := v_results || jsonb_build_object(
      'step_index', v_idx,
      'result_instance_id', v_result_id,
      'result_quantity', v_result_qty
    );
  end loop;

  update public.collection_write_ops
     set result_steps = v_results
   where id = p_operation_id;

  return query
    select (elem->>'step_index')::integer,
           (elem->>'result_instance_id')::uuid,
           (elem->>'result_quantity')::integer,
           false
      from jsonb_array_elements(v_results) as elem
     order by (elem->>'step_index')::integer;
end;
$$;

revoke all on function public.apply_stack_rekey(uuid, jsonb) from public;
grant execute on function public.apply_stack_rekey(uuid, jsonb) to authenticated;
