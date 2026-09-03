-- ---------------------------------------------------------------------------
-- Trade proposals expire.
--
-- An offer nobody answers should not sit "pending" forever — it clutters the
-- list and, worse, could be accepted months later against cards that have long
-- since moved. So a proposal carries an expires_at, set 14 days out when it is
-- made, after which it can no longer be accepted.
--
-- Nullable, and null means "never expires": every trade proposed before this
-- migration keeps working, and a completed/declined trade is unaffected either
-- way. The clock only matters while a trade is still 'proposed'.
--
-- No sweeper job flips expired rows to a terminal status — the expiry is a
-- derived fact (expires_at < now()), checked where it matters: accept_trade()
-- refuses, and the UI shows it. A cron just to change a label would be moving
-- parts for no gain.
-- ---------------------------------------------------------------------------

alter table public.trades
  add column if not exists expires_at timestamptz;

comment on column public.trades.expires_at is
  'When a still-open proposal stops being acceptable. Null = no expiry (pre-feature trades).';

create index if not exists trades_expires_at_idx
  on public.trades (expires_at)
  where status = 'proposed';

-- ---------------------------------------------------------------------------
-- accept_trade(): also refuse an expired proposal.
--
-- Same function as migration 12, with one added guard right after the status
-- check. Copied whole rather than patched so the transfer body stays the
-- reviewed version verbatim.
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

  if v_trade.status <> 'proposed' then
    raise exception 'This trade is already %', v_trade.status
      using errcode = 'invalid_parameter_value';
  end if;

  -- Added in migration 13.
  if v_trade.expires_at is not null and v_trade.expires_at <= now() then
    raise exception 'This offer has expired'
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
