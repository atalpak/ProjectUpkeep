-- ---------------------------------------------------------------------------
-- Terms acceptance, and counter-offers.
--
-- Two small additions that the roadmap's next two items need (docs/feature-
-- roadmap.md, Tier 1 "counter" and Tier 4 "ToS acceptance flow"):
--
--   1. profiles gains when-and-what-version of the trading terms a user has
--      accepted. The charter is explicit that the operator is not a party to
--      any peer trade; that disclaimer has to be accepted before a user can
--      propose or accept a trade, and it has to be re-accepted if the terms
--      change. Nullable, because every existing user predates the flow and is
--      prompted on their next visit to the friends page.
--
--   2. trades gains countered_from: the trade this one replaces. A counter-
--      offer is not an in-place edit of someone else's proposal — it is a new
--      proposal, authored by the person who received the first one, that
--      supersedes it. Modelling it as a fresh row keeps accept_trade() and
--      every insert policy from migration 9 untouched; the only new rule is
--      that the superseded row may move to the terminal 'countered' status.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Terms acceptance
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists tos_accepted_at timestamptz,
  add column if not exists tos_version     text;

comment on column public.profiles.tos_accepted_at is
  'When this user last accepted the trading terms. Null = never; they are prompted before trading.';
comment on column public.profiles.tos_version is
  'The terms version accepted. Compared against the app''s current version so a change forces re-acceptance.';

-- The existing "profiles: update own" policy (migration 2) already lets a user
-- write their own row with check (id = auth.uid()), which is exactly the
-- self-attestation this needs. No new policy.

-- ---------------------------------------------------------------------------
-- 2. Counter-offers
-- ---------------------------------------------------------------------------

alter table public.trades
  add column if not exists countered_from uuid
    references public.trades (id) on delete set null;

comment on column public.trades.countered_from is
  'The trade this one was proposed to replace. Null for an original proposal.';

create index if not exists trades_countered_from_idx
  on public.trades (countered_from);

-- Widen the close policy so a party may also mark an open trade 'countered'.
-- 'countered' is terminal here, like 'declined' and 'cancelled' — it moves no
-- cards. Only accept_trade() can still produce 'accepted' or 'completed'.
drop policy if exists "trades: close own" on public.trades;
create policy "trades: close own"
  on public.trades for update
  to authenticated
  using (
    (proposer_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and status in ('proposed', 'countered')
  )
  with check (status in ('declined', 'cancelled', 'countered'));

-- ---------------------------------------------------------------------------
-- accept_trade(): a 'countered' trade can no longer be accepted.
--
-- In migration 9 'countered' was an unreachable status, so accept_trade()
-- tolerating it was harmless dead code. Now a counter-offer actually moves the
-- original to 'countered' and it is superseded — accepting it directly (which
-- a stale client could still ask for) would execute a swap the recipient
-- already replaced. The only change from migration 9 is the status guard;
-- everything else is copied verbatim so the transfer stays byte-for-byte the
-- reviewed version.
-- ---------------------------------------------------------------------------

create or replace function public.accept_trade(p_trade_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_trade      public.trades;
  v_item       record;
  v_instance   public.card_instances;
  v_from       uuid;
  v_to         uuid;
  v_new_id     uuid;
begin
  if v_actor is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE: two people accepting at once must not both transfer.
  select * into v_trade from public.trades where id = p_trade_id for update;

  if not found then
    raise exception 'No such trade' using errcode = 'no_data_found';
  end if;

  if v_trade.recipient_id <> v_actor then
    raise exception 'Only the recipient can accept this trade'
      using errcode = 'insufficient_privilege';
  end if;

  -- Changed from migration 9: 'countered' is no longer acceptable.
  if v_trade.status <> 'proposed' then
    raise exception 'This trade is already %', v_trade.status
      using errcode = 'invalid_parameter_value';
  end if;

  for v_item in
    select * from public.trade_items where trade_id = p_trade_id order by created_at
  loop
    -- Lock each card so it cannot be edited or traded away underneath us.
    select * into v_instance
      from public.card_instances
     where id = v_item.card_instance_id
     for update;

    if not found then
      raise exception 'A card in this trade no longer exists'
        using errcode = 'no_data_found';
    end if;

    if v_item.direction = 'from_proposer' then
      v_from := v_trade.proposer_id;
      v_to   := v_trade.recipient_id;
    else
      v_from := v_trade.recipient_id;
      v_to   := v_trade.proposer_id;
    end if;

    if v_instance.owner_user_id <> v_from then
      raise exception 'A card in this trade is no longer owned by the person offering it'
        using errcode = 'invalid_parameter_value';
    end if;

    if v_instance.quantity < v_item.quantity then
      raise exception 'Only % of that card remain, but % were offered',
        v_instance.quantity, v_item.quantity
        using errcode = 'invalid_parameter_value';
    end if;

    if v_instance.quantity = v_item.quantity then
      -- The whole stack moves. Keep the row so trade_items still points at
      -- something real, and so its notes and acquisition date survive.
      update public.card_instances
         set owner_user_id = v_to,
             location_id   = null
       where id = v_instance.id;

      v_new_id := v_instance.id;
    else
      -- Split: the sender keeps the remainder, the receiver gets a new row.
      update public.card_instances
         set quantity = quantity - v_item.quantity
       where id = v_instance.id;

      insert into public.card_instances
        (owner_user_id, card_id, location_id, condition, finish, language, quantity, notes)
      values
        (v_to, v_instance.card_id, null, v_instance.condition, v_instance.finish,
         v_instance.language, v_item.quantity, v_instance.notes)
      returning id into v_new_id;
    end if;

    insert into public.ownership_history
      (card_instance_id, from_user_id, to_user_id, trade_id)
    values
      (v_new_id, v_from, v_to, p_trade_id);
  end loop;

  update public.trades
     set status = 'completed'
   where id = p_trade_id;
end;
$$;

revoke all on function public.accept_trade(uuid) from public;
grant execute on function public.accept_trade(uuid) to authenticated;
