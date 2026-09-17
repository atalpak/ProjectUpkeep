-- ---------------------------------------------------------------------------
-- Phase 3a of the mobile initiative: atomic stack merges, safe under two
-- independent writers.
--
-- Mobile's scanner is about to gain the same stacking policy the web app
-- already applies on add (originally src/lib/collection/stacking.ts, now
-- shared with mobile via packages/upkeep-domain -- see that package's
-- header). That policy decides merge-vs-insert from a read that is, by
-- construction, stale by the time the write lands: a phone and a laptop (or
-- two phones) can both read "quantity 3" for the same stack, both decide
-- "merge to 4", and two plain `update ... set quantity = 4` statements leave
-- the row at 4, not 5 -- one scanned copy silently vanishes. Nothing before
-- this migration made that write atomic, because nothing before this phase
-- had a second client racing the web app's own read-decide-write.
--
-- The fix has two parts, both below:
--
--   1. The write itself becomes an atomic increment under a row lock
--      (`quantity = quantity + p_quantity ... for update`), never an
--      overwrite of a precomputed total. Two callers deciding against the
--      same stale read now serialise into 4 then 6, not both into 4.
--
--   2. collection_write_ops is a durable ledger of applied operation ids, so
--      a retried or uncertain call (lost response, app killed mid-request --
--      see apps/mobile's persist-before-write shape) can never apply twice.
--      The ledger insert happens first, in the same transaction as the merge
--      or insert: `insert ... on conflict (id) do nothing`. This is safe
--      against a genuinely concurrent second call with the *same* operation
--      id, not just a sequential retry -- verified against Postgres's
--      documented ON CONFLICT behaviour, not assumed: unlike a plain INSERT
--      hitting a unique violation (which raises immediately under READ
--      COMMITTED), `INSERT ... ON CONFLICT DO NOTHING` blocks on a
--      conflicting concurrent transaction until it commits or rolls back,
--      then re-evaluates whether the row exists. So the second of two
--      simultaneous identical calls waits for the first to finish, sees its
--      row, and takes the replay branch below -- it cannot race past the
--      first far enough to double-apply.
--
-- The stacking DECISION -- merge vs insert, and which candidate row -- stays
-- out of this function, deliberately. CLAUDE.md's "two reversible bets"
-- keeps STACKING_ENABLED a one-file flip with no migration required; giving
-- the database its own copy of that policy would spend that bet the first
-- time the two disagreed, and every calling client would still have to
-- decide correctly which row is a candidate in the first place. This
-- function only carries out whichever instruction application code already
-- decided on: merge into this exact row, or insert this exact row. When
-- STACKING_ENABLED is false, `decideStacking` never returns "merge", so no
-- caller ever passes a target instance id, and only the insert branch below
-- ever runs -- see packages/upkeep-domain/src/stacking.ts's header.
--
-- SECURITY INVOKER, not DEFINER: hard constraint 5 reserves SECURITY DEFINER
-- exclusively for accept_trade's cross-user transfer. Everything this
-- function does -- read/lock/update one card_instances row the caller already
-- owns, or insert one the caller is about to own, plus write one row on a
-- ledger table the caller owns -- a signed-in user's own RLS policies already
-- permit. There is no privilege to elevate, and no owner parameter: the owner
-- of a new row is auth.uid(), read inside the function, exactly like every
-- other insert into card_instances. A caller-suppliable owner would be an
-- ownership-transfer path that bypasses accept_trade, which is not on the
-- table.
--
-- collection_write_ops is enrolled in delete_own_account's (migration 30)
-- cleanup for free, via its own `on delete cascade` from auth.users -- the
-- same mechanism migration 30 already relies on for locations, card_instances,
-- friendships and the rest. Migration 30 cannot be edited to say so (hard
-- constraint 8: never edit an applied migration), so this is where that fact
-- is recorded for a table that did not exist yet when it was written.
-- ---------------------------------------------------------------------------

create table public.collection_write_ops (
  id                 uuid primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  kind               text not null check (kind in ('stack_add')),
  fingerprint        text not null,
  result_instance_id uuid,
  result_quantity    integer,
  created_at         timestamptz not null default now()
);

create index collection_write_ops_user_idx
  on public.collection_write_ops (user_id, created_at desc);

comment on table public.collection_write_ops is
  $$Idempotency ledger for client-originated write operations. The row id IS the
idempotency key -- a client mints it once per logical action and resubmits the
same id on any retry. Enrolled in delete_own_account's (migration 30) cascade
cleanup via this table's own `on delete cascade` from auth.users; migration 30
predates this table and cannot be edited to mention it (hard constraint 8).$$;

-- ---------------------------------------------------------------------------
-- Append-only, with one exception: the function that inserts a ledger row is
-- allowed to come back and fill in its result once the write it guards has
-- happened. Modelled on ownership_history's append-only trigger (migration 6)
-- -- ownership_history's is stricter (UPDATE is refused outright, for every
-- role, because an audit log with any mutable field is not an audit log); this
-- one exists to serve a real, narrow mutation, so it blocks everything except
-- that one, and only once.
-- ---------------------------------------------------------------------------
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
     or (old.result_quantity is not null and new.result_quantity is distinct from old.result_quantity) then
    raise exception 'collection_write_ops: result cannot be changed once recorded'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger collection_write_ops_immutable
  before update on public.collection_write_ops
  for each row execute function public.enforce_write_op_immutability();

-- ---------------------------------------------------------------------------
-- RLS: your own operations, nobody else's. No delete policy -- a ledger row
-- is only ever removed by the account-deletion cascade above, never by a
-- client request.
-- ---------------------------------------------------------------------------
alter table public.collection_write_ops enable row level security;

create policy "collection_write_ops: select own"
  on public.collection_write_ops for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "collection_write_ops: insert own"
  on public.collection_write_ops for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Needed so apply_stack_addition (SECURITY INVOKER) can fill in the result
-- columns after the write. The trigger above is what actually stops those
-- columns -- or id/user_id/kind/fingerprint -- from being rewritten; this
-- policy only says "your own row, and only via a client permitted to update
-- it at all."
create policy "collection_write_ops: update own"
  on public.collection_write_ops for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- apply_stack_addition(): the one atomic write both clients now go through
-- for a confirmed addition.
--
-- p_target_instance_id null means "insert" -- the caller's stacking decision
-- was "insert", not "there is no target yet". Passing a target means "merge
-- into exactly this row", and this function re-verifies that row still
-- matches the stack key before touching it; it does not trust the caller's
-- read.
-- ---------------------------------------------------------------------------
create or replace function public.apply_stack_addition(
  p_operation_id       uuid,
  p_target_instance_id uuid,
  p_card_id            uuid,
  p_condition          text,
  p_finish             text,
  p_language           text,
  p_location_id        uuid,
  p_quantity           integer,
  p_notes              text
)
returns table (result_instance_id uuid, result_quantity integer, replayed boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_fingerprint text;
  v_ledger      public.collection_write_ops;
  v_rowcount    integer;
  v_instance_id uuid;
  v_quantity    integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive integer' using errcode = 'invalid_parameter_value';
  end if;

  -- Canonical string over every field the decision was made from. Location
  -- deliberately included even though it is nullable ("unsorted" is a real,
  -- distinct value, not the absence of one) via a NULL-safe cast.
  v_fingerprint := concat_ws('|',
    p_card_id::text, p_condition, p_finish, p_language,
    coalesce(p_location_id::text, '<unsorted>'), p_quantity::text,
    coalesce(p_notes, ''));

  -- Ledger-first, same transaction as the write below -- see the migration
  -- header for why ON CONFLICT DO NOTHING is what makes this safe against a
  -- genuinely concurrent second call with the same operation id, not just a
  -- sequential retry.
  insert into public.collection_write_ops (id, user_id, kind, fingerprint)
  values (p_operation_id, v_uid, 'stack_add', v_fingerprint)
  on conflict (id) do nothing;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 0 then
    -- Replay. RLS still applies (SECURITY INVOKER): if this operation id was
    -- somehow already claimed by a different account, "select own" hides it
    -- entirely, which reads identically to "no such id" below -- there is no
    -- legitimate reason for that to happen (ids are client-minted UUIDs), and
    -- either way this account gets no information about someone else's row.
    select * into v_ledger from public.collection_write_ops where id = p_operation_id;

    if not found then
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

  if p_target_instance_id is not null then
    -- Merge branch. Re-verify the exact stack key under the row lock rather
    -- than trusting the caller's (necessarily stale) read -- the row may have
    -- moved location, been edited, or stopped being this caller's at all
    -- since the decision was made. `location_id is not distinct from`, not
    -- `=`: NULL ("unsorted") is a real value here, and `=` never matches it.
    -- Only un-annotated rows merge, matching decideStacking's own rule that
    -- an incoming card only ever decides "merge" against an un-annotated
    -- candidate.
    perform 1
      from public.card_instances
     where id = p_target_instance_id
       and owner_user_id = v_uid
       and card_id = p_card_id
       and condition = p_condition
       and finish = p_finish
       and language = p_language
       and location_id is not distinct from p_location_id
       and coalesce(btrim(notes), '') = ''
     for update;

    if not found then
      raise exception 'That stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours'
        using errcode = 'no_data_found';
    end if;

    -- The atomic part: an increment, never an overwrite of a precomputed
    -- total. Only quantity moves -- owner_user_id and location_id are
    -- untouched, keeping ownership and location decoupled (hard constraint 6)
    -- on this write path exactly as everywhere else. The owner filter here is
    -- redundant with RLS's own "card_instances: update own" policy under
    -- SECURITY INVOKER (an UPDATE is filtered by that policy regardless of
    -- this WHERE clause) -- written explicitly anyway, matching this
    -- codebase's "RLS is the floor, not the whole filter" discipline
    -- (.claude/rules/data-access.md), and so this statement fails closed
    -- (NOT FOUND, not a silent no-op) if that floor is ever the only thing
    -- standing between this row and someone who merely decided against it.
    update public.card_instances
       set quantity = quantity + p_quantity
     where id = p_target_instance_id
       and owner_user_id = v_uid
    returning id, quantity into v_instance_id, v_quantity;

    if not found then
      raise exception 'That stack could not be updated -- it may no longer be yours'
        using errcode = 'no_data_found';
    end if;
  else
    -- Insert branch: identical fields to what addCardInstance already writes.
    -- This still fires card_instances_enforce_location_owner (migration 5);
    -- let it -- a location that is not this caller's should still refuse here.
    insert into public.card_instances
      (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
    values
      (v_uid, p_card_id, p_location_id, p_condition, p_finish, p_language, p_quantity, p_notes)
    returning id, quantity into v_instance_id, v_quantity;
  end if;

  update public.collection_write_ops
     set result_instance_id = v_instance_id,
         result_quantity    = v_quantity
   where id = p_operation_id;

  return query select v_instance_id, v_quantity, false;
end;
$$;

revoke all on function public.apply_stack_addition(
  uuid, uuid, uuid, text, text, text, uuid, integer, text
) from public;
grant execute on function public.apply_stack_addition(
  uuid, uuid, uuid, text, text, text, uuid, integer, text
) to authenticated;
