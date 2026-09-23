-- ---------------------------------------------------------------------------
-- One atomic re-file, replacing four separate read-decide-write paths that
-- were never made safe the way migrations 36/38/39 made adding, moving and
-- reprinting safe.
--
-- The architect's impact map (2026-09-22, recorded in
-- apps/mobile/docs/BACKLOG.md under backlog item 2) found this was bigger than
-- "updateCardInstance leaves a duplicate row": `unsleeveCopies` and
-- `removeEntryFromList` (src/app/(app)/decks/actions.ts) ignore every write
-- error, so a partial failure there does not duplicate a row, it makes copies
-- VANISH silently -- worse than anything else in this item. `addToDeck`'s
-- source read and `bulkMerge`'s read both skipped the owner filter hard
-- constraint 3 requires. And the web's sleeve action shrinks the source and
-- grows the destination as two separate requests, so a failure between them
-- can lose copies outright, the same defect migration 38's header already
-- flagged and deliberately left unfixed on the web side pending this work.
--
-- Rather than patch each of updateCardInstance / bulkMove / bulkSetField /
-- sleeveCopies / unsleeveCopies / removeFromDeck / bulkMerge separately, the
-- owner approved one shape: an ordered list of STEPS, applied in one
-- transaction, all-or-nothing. A one-row-per-call signature was considered and
-- rejected -- bulk actions run over up to 5,000 rows (MAX_BULK_IDS), and
-- ~10,000 sequential round trips for a single bulk action would very likely
-- time out on Vercel. Every web path in backlog item 2 now builds a list of
-- steps and makes one call.
--
-- Each step is one of:
--
--   'set_quantity' -- sets one owned row's quantity to an absolute value, in
--   place. This is what the edit form's "quantity" field has always meant
--   ("this stack now holds N"), never "move N copies" -- so it never touches
--   condition/finish/language/location_id, and (owner decision, 2026-09-22)
--   never trips the open-trade gate below: the row and its owner are
--   unchanged, exactly the "keep the row" case apply_stack_reprint's in-place
--   branch already established as safe under an open trade.
--
--   'rekey' -- moves some or all of a row's quantity to a new
--   condition/finish/language/location, optionally merging into an existing
--   matching pile (p_target_instance_id), otherwise updating in place (the
--   whole stack, nothing to merge into) or splitting (part of the stack, no
--   merge target). This is the shape migration 39 already uses for reprinting
--   a printing; rekey is the same operation over the OTHER four columns that
--   make up a stack key (packages/upkeep-domain/src/stacking.ts).
--
-- The edit form changing quantity and attributes together -- e.g. "these 4 are
-- actually only 3, and 3 of them go to LP in the Trade Binder" -- is submitted
-- as a set_quantity step followed by a rekey step for the resulting quantity,
-- the same two-steps-not-one resolution the reprint feature already uses for
-- the identical ambiguity (a single "quantity" field cannot mean both "set the
-- stack to N" and "move N of them" at once).
--
--
-- WHY THE ORDER WITHIN A REKEY STEP IS LOAD-BEARING
--
-- Exactly the migration 20/37/39 hazard, restated for a fourth write path:
-- card_instances_list_in_deck_on_quantity_change fires AFTER UPDATE OF
-- quantity, is monotone-up, and compares physical vs listed totals. If a
-- merge's destination increment ran before the source gave its copies up, the
-- trigger would see an inflated physical total, add a shortfall, and
-- permanently raise deck_cards -- the bug bulkMerge had until PR #79 and the
-- exact thing migration 39's reprint was built to avoid. So: source side
-- (delete or decrement) always first, destination side (increment, in-place
-- update, or insert) always second. Section 21 of schema_test.sql exercises
-- this the same way section 19 exercises it for reprint -- confirmed to fail
-- with the two sides swapped before being allowed to pass.
--
--
-- WHY THE OPEN-TRADE GATE APPLIES TO MERGE AND SPLIT ONLY
--
-- apply_stack_reprint gates every one of its branches, because every branch
-- changes card_id -- there is no branch of a reprint that leaves a trade's
-- counterparty looking at the same card they agreed to once card_id has
-- changed. A rekey is different: it never changes card_id, so a row that
-- stays exactly the row it was (a whole-stack rekey with nothing to merge
-- into -- the in-place branch) still points accept_trade at the same
-- card_instances.id it always did, still holding the same card. What
-- genuinely threatens an open trade is the row being emptied into a different
-- id (merge) or split so the traded row is no longer the whole story (split)
-- -- either can leave trade_items pointing at a row that no longer represents
-- what was offered. So (owner decision, 2026-09-22): block merge and split,
-- allow staying in the same row no matter what else about it changes. The
-- gate's predicate matches apply_stack_reprint's and accept_trade's own live
-- checks (migration 13): status = 'proposed', not past expires_at.
--
--
-- WHY THE FINISH CHECK ONLY FIRES WHEN THE FINISH ACTUALLY CHANGES
--
-- apply_stack_reprint refuses an impossible finish unconditionally, because a
-- reprint's whole purpose is picking a new printing and a finish has to be
-- settled against it. A rekey's purpose is different -- condition, finish,
-- language or location, independently -- and the edit form has always let a
-- copy keep whatever finish it already has, even when the catalog's
-- available_finishes looks like it should not allow it (Scryfall's finish data
-- is not perfectly clean, and refusing to save an unrelated location change
-- because of that would be a regression, not a safety improvement). So (owner
-- decision, 2026-09-22): validate the finish only when p_finish differs from
-- the locked source row's own finish.
--
--
-- WHY REPLAY STORES A JSON ARRAY, NOT collection_write_ops' two result columns
--
-- Every sibling in this family (migrations 36/38/39) applies exactly one
-- logical change and records one result_instance_id/result_quantity pair.
-- This function applies an ordered LIST, so a replay has to return one result
-- per step, not one overall. `result_details jsonb` carries `[{step_index,
-- result_instance_id, result_quantity}, ...]` for kind = 'stack_rekey' only --
-- the two existing columns stay exactly as the other three kinds already use
-- them. enforce_write_op_immutability (migration 37) is extended, not
-- replaced, to hold this new column to the same "settable once, then
-- immutable" rule it already holds the other two to.
--
--
-- WHY THE OWNER FILTER IS WRITTEN EXPLICITLY THROUGHOUT
--
-- Hard constraint 3, restated for a fourth time in this family: migration 9
-- makes a friend's tradable-binder rows genuinely SELECT-able, so every lookup
-- here -- the source lock, the merge-target re-verification -- pins
-- owner_user_id = auth.uid() itself rather than trusting RLS alone. This is
-- also the fix for the two gaps the impact map found: `addToDeck`'s source
-- read and `bulkMerge`'s read used to skip this filter entirely (exploitable
-- only via a hand-crafted request, not through the UI, since RLS's own UPDATE
-- policy would still refuse the actual write -- but a real gap, and one this
-- function closes structurally rather than by patching each caller).
--
--
-- SECURITY INVOKER, not DEFINER, for the reason every sibling gives: this
-- reads and writes only the caller's own rows (or a row a caller is refused
-- from touching if it is not), under the caller's own RLS policies. There is
-- no owner parameter anywhere in the signature; owner_user_id is written only
-- ever as auth.uid(). A rekey that could retarget ownership would be a second,
-- unaudited transfer path competing with accept_trade (hard constraint 5).
--
-- Not a trade, for the same reason migrations 38/39 give: owner_user_id never
-- changes on any row this function touches, so no ownership_history row is
-- written (that table has no INSERT policy at all outside accept_trade --
-- migration 9 -- and its append-only trigger, migration 6, would refuse a
-- correction if one were ever needed). The audit is collection_write_ops with
-- kind = 'stack_rekey', the same as every sibling in this family.
-- ---------------------------------------------------------------------------

alter table public.collection_write_ops
  add column if not exists result_details jsonb;

alter table public.collection_write_ops
  drop constraint if exists collection_write_ops_kind_check;

alter table public.collection_write_ops
  add constraint collection_write_ops_kind_check
  check (kind in ('stack_add', 'stack_move', 'stack_reprint', 'stack_rekey'));

-- Extends, not replaces, migration 37's rule: result_details joins
-- result_instance_id/result_quantity as settable-once-then-immutable.
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
     or (old.result_details is not null and new.result_details is distinct from old.result_details) then
    raise exception 'collection_write_ops: result cannot be changed once recorded'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_stack_rekey(): the shared atomic write for updateCardInstance,
-- bulkMove, bulkSetField, sleeveCopies/unsleeveCopies, removeFromDeck's
-- replacement, and bulkMerge.
--
-- p_steps is a JSON array of step objects (kept as jsonb, not a Postgres
-- composite array, so the client-side call is a plain array literal rather
-- than needing composite-type marshalling through PostgREST):
--
--   { "mode": "set_quantity", "source_instance_id": "<uuid>", "quantity": N }
--
--   { "mode": "rekey", "source_instance_id": "<uuid>", "quantity": N,
--     "condition": "NM", "finish": "nonfoil", "language": "en",
--     "location_id": "<uuid>" | null, "notes": "<text>" | null,
--     "target_instance_id": "<uuid>" | null }
--
-- A rekey step's condition/finish/language/location_id/notes are always the
-- FULL post-rekey stack key and notes value, not a partial patch -- the same
-- "write the whole key" shape every sibling in this family uses.
-- ---------------------------------------------------------------------------
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
  v_step_count   integer;
  v_step         jsonb;
  v_mode         text;
  v_source_id    uuid;
  v_target_id    uuid;
  v_quantity     integer;
  v_condition    text;
  v_finish       text;
  v_language     text;
  v_location_id  uuid;
  v_notes        text;
  v_source       public.card_instances;
  v_card         public.cards;
  v_open_trades  integer;
  v_instance_id  uuid;
  v_new_quantity integer;
  v_results      jsonb := '[]'::jsonb;
  i              integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'p_steps must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  v_step_count := jsonb_array_length(p_steps);

  if v_step_count = 0 then
    raise exception 'p_steps must not be empty' using errcode = 'invalid_parameter_value';
  end if;

  -- Twice MAX_BULK_IDS (src/app/(app)/collection/bulk-state.ts, 5,000): a bulk
  -- action's own selection cap is 5,000 rows, and the busiest caller
  -- (bulkMerge) emits at most one step per selected row, but a sleeve or an
  -- edit-form save can emit two steps for one underlying user action (a
  -- quantity step and a rekey step) -- see the header. 10,000 is headroom for
  -- that, not a real expectation.
  if v_step_count > 10000 then
    raise exception 'That is too many steps in one call' using errcode = 'invalid_parameter_value';
  end if;

  -- jsonb's canonical text form has stable key order and whitespace, so two
  -- calls carrying the same logical steps fingerprint identically regardless
  -- of how the caller serialised them.
  v_fingerprint := p_steps::text;

  -- Ledger-first, same transaction as every step below -- see migration 36's
  -- header for why ON CONFLICT DO NOTHING is safe against a genuinely
  -- concurrent second call with the same operation id, not merely a retry.
  insert into public.collection_write_ops (id, user_id, kind, fingerprint)
  values (p_operation_id, v_uid, 'stack_rekey', v_fingerprint)
  on conflict (id) do nothing;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 0 then
    select * into v_ledger from public.collection_write_ops where id = p_operation_id;

    if not found then
      -- RLS's "select own" hides another account's row entirely, so this
      -- reads identically to "no such id" and leaks nothing about who holds
      -- it -- the same reasoning every sibling in this family gives.
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
        from jsonb_array_elements(coalesce(v_ledger.result_details, '[]'::jsonb)) elem;
    return;
  end if;

  for i in 0 .. v_step_count - 1 loop
    v_step      := p_steps -> i;
    v_mode      := v_step ->> 'mode';
    v_source_id := nullif(v_step ->> 'source_instance_id', '')::uuid;
    v_quantity  := (v_step ->> 'quantity')::integer;

    if v_source_id is null then
      raise exception 'step %: source_instance_id is required', i
        using errcode = 'invalid_parameter_value';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'step %: quantity must be a positive integer', i
        using errcode = 'invalid_parameter_value';
    end if;

    if v_mode = 'set_quantity' then
      update public.card_instances
         set quantity = v_quantity
       where id = v_source_id
         and owner_user_id = v_uid
      returning id, quantity into v_instance_id, v_new_quantity;

      if not found then
        raise exception 'step %: that copy could not be updated -- it may no longer be yours', i
          using errcode = 'no_data_found';
      end if;

    elsif v_mode = 'rekey' then
      v_target_id   := nullif(v_step ->> 'target_instance_id', '')::uuid;
      v_condition   := v_step ->> 'condition';
      v_finish      := v_step ->> 'finish';
      v_language    := v_step ->> 'language';
      v_location_id := nullif(v_step ->> 'location_id', '')::uuid;
      v_notes       := v_step ->> 'notes';

      if v_condition is null or v_finish is null or v_language is null then
        raise exception 'step %: condition, finish and language are required', i
          using errcode = 'invalid_parameter_value';
      end if;

      if v_target_id is not null and v_target_id = v_source_id then
        raise exception 'step %: a copy cannot be merged into itself', i
          using errcode = 'invalid_parameter_value';
      end if;

      -- Lock and re-verify the source under the row lock, not whatever the
      -- caller read before deciding on this step.
      select * into v_source
        from public.card_instances
       where id = v_source_id
         and owner_user_id = v_uid
         and quantity >= v_quantity
       for update;

      if not found then
        raise exception 'step %: that copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours', i
          using errcode = 'no_data_found';
      end if;

      -- Only refused when the finish is actually changing -- see the header.
      if v_finish <> v_source.finish then
        select * into v_card from public.cards where scryfall_id = v_source.card_id;

        if v_card is null or not (v_finish = any (coalesce(v_card.available_finishes, '{}'))) then
          raise exception 'step %: that printing does not come in %', i, v_finish
            using errcode = 'invalid_parameter_value';
        end if;
      end if;

      if v_target_id is not null or v_quantity < v_source.quantity then
        -- MERGE or SPLIT: some or all of this stack is leaving the row behind
        -- (into a different existing row, or a freshly inserted one). See the
        -- header for why the gate applies here and only here.
        select count(*) into v_open_trades
          from public.trade_items ti
          join public.trades t on t.id = ti.trade_id
         where ti.card_instance_id = v_source.id
           and t.status = 'proposed'
           and (t.expires_at is null or t.expires_at > now());

        if v_open_trades > 0 then
          raise exception 'step %: this copy is in an open trade offer -- cancel or complete the trade first', i
            using errcode = 'invalid_parameter_value';
        end if;
      end if;

      if v_target_id is not null then
        -- MERGE BRANCH. Source side first, always -- see the header. This is
        -- the exact ordering bulkMerge had wrong until PR #79 and migration
        -- 39 already had to get right once; this function must not become a
        -- fourth place it can recur.
        if v_source.quantity = v_quantity then
          delete from public.card_instances where id = v_source.id;
        else
          update public.card_instances
             set quantity = quantity - v_quantity
           where id = v_source.id
             and owner_user_id = v_uid;
        end if;

        -- Re-verify the full post-rekey stack key under the row lock, not the
        -- caller's necessarily stale read.
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
          raise exception 'step %: that destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours', i
            using errcode = 'no_data_found';
        end if;

        update public.card_instances
           set quantity = quantity + v_quantity
         where id = v_target_id
           and owner_user_id = v_uid
        returning id, quantity into v_instance_id, v_new_quantity;

        if not found then
          raise exception 'step %: that destination stack could not be updated -- it may no longer be yours', i
            using errcode = 'no_data_found';
        end if;

      elsif v_quantity = v_source.quantity then
        -- IN-PLACE BRANCH: the whole stack takes on a new key with nothing to
        -- merge into. Update rather than delete-and-reinsert, so the row keeps
        -- its id, acquired_at, and any trade_items pointing at it -- the same
        -- reason apply_stack_reprint's in-place branch exists, and exactly
        -- the case the open-trade gate above deliberately does not block.
        update public.card_instances
           set condition   = v_condition,
               finish      = v_finish,
               language    = v_language,
               location_id = v_location_id,
               notes       = v_notes
         where id = v_source.id
           and owner_user_id = v_uid
        returning id, quantity into v_instance_id, v_new_quantity;

        if not found then
          raise exception 'step %: that copy could not be updated -- it may no longer be yours', i
            using errcode = 'no_data_found';
        end if;

      else
        -- SPLIT BRANCH: part of the stack takes on a new key and there is
        -- nothing to merge it into. Decrement first, same ordering rule as
        -- the merge branch, then insert the re-keyed portion.
        update public.card_instances
           set quantity = quantity - v_quantity
         where id = v_source.id
           and owner_user_id = v_uid;

        insert into public.card_instances
          (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
        values
          (v_uid, v_source.card_id, v_location_id, v_condition, v_finish, v_language, v_quantity, v_notes)
        returning id, quantity into v_instance_id, v_new_quantity;
      end if;

    else
      raise exception 'step %: unknown mode %', i, coalesce(v_mode, '<missing>')
        using errcode = 'invalid_parameter_value';
    end if;

    v_results := v_results || jsonb_build_object(
      'step_index', i,
      'result_instance_id', v_instance_id,
      'result_quantity', v_new_quantity
    );
  end loop;

  update public.collection_write_ops
     set result_details = v_results
   where id = p_operation_id;

  return query
    select (elem->>'step_index')::integer,
           (elem->>'result_instance_id')::uuid,
           (elem->>'result_quantity')::integer,
           false
      from jsonb_array_elements(v_results) elem;
end;
$$;

revoke all on function public.apply_stack_rekey(uuid, jsonb) from public;
grant execute on function public.apply_stack_rekey(uuid, jsonb) to authenticated;
