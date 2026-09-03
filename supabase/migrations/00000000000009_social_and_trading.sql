-- ---------------------------------------------------------------------------
-- Phase 2: friends, tradable locations, and real trade execution.
--
-- This is the first migration where one user's rows become visible to another,
-- so almost all of it is access control. Three ideas, in order:
--
--   1. A location can be marked tradable. That, and only that, is what makes
--      cards visible to anyone else. It reuses the physical premise the whole
--      product rests on: your trade binder is a real binder, and filing a card
--      into it is the same gesture as offering it.
--
--   2. Friendship is mutual and explicit. One row per pair, requested by one
--      side and accepted by the other. Nothing is visible to strangers.
--
--   3. Accepting a trade moves the cards. card_instances RLS pins
--      owner_user_id in both USING and WITH CHECK precisely so a client can
--      never reassign ownership; the transfer therefore lives in a security
--      definer function, which is also the only way to make it atomic.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tradable locations
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists is_tradable boolean not null default false;

comment on column public.locations.is_tradable is
  'When true, this container''s cards are visible to the owner''s friends as available for trade.';

create index if not exists locations_tradable_idx
  on public.locations (user_id) where is_tradable;

-- ---------------------------------------------------------------------------
-- friendships
--
-- One row per pair, not two. The unique index is on the ordered pair, so
-- A-requests-B and B-requests-A cannot both exist — whoever asks first owns the
-- row, and the other side answers it.
--
-- No 'declined' status is stored. A declined request is deleted, so the pair
-- can ask again later; keeping a tombstone would either block a future request
-- or leak that someone said no.
-- ---------------------------------------------------------------------------

create table if not exists public.friendships (
  id           uuid primary key default extensions.gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,

  status       text not null default 'pending'
                 check (status in ('pending', 'accepted')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint friendships_distinct_parties check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists friendships_requester_idx on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- are_friends()
--
-- Used inside RLS policies on other tables. It must be SECURITY DEFINER: the
-- policies on card_instances need to consult friendships, and a plain query
-- there would itself be filtered by friendships' own policies, which is both
-- circular and slow.
--
-- STABLE, and search_path pinned to a literal — a SECURITY DEFINER function
-- with a mutable search_path is the classic Postgres privilege-escalation hole.
-- ---------------------------------------------------------------------------

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id)    = least(a, b)
       and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

alter table public.friendships enable row level security;

-- You can see a friendship row only if you are in it.
drop policy if exists "friendships: read own" on public.friendships;
create policy "friendships: read own"
  on public.friendships for select
  to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

-- You may only ever create a request as yourself, and only pending.
drop policy if exists "friendships: request as self" on public.friendships;
create policy "friendships: request as self"
  on public.friendships for insert
  to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');

-- Only the addressee accepts. USING pins who may act; WITH CHECK stops the
-- update being used to rewrite the pair or hand the row to someone else.
drop policy if exists "friendships: addressee accepts" on public.friendships;
create policy "friendships: addressee accepts"
  on public.friendships for update
  to authenticated
  using (addressee_id = (select auth.uid()))
  with check (addressee_id = (select auth.uid()) and status = 'accepted');

-- Either side can withdraw a request or unfriend.
drop policy if exists "friendships: either side removes" on public.friendships;
create policy "friendships: either side removes"
  on public.friendships for delete
  to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- profiles: readable by any signed-in user
--
-- Finding someone to befriend means looking them up by username, which cannot
-- work if profiles are private. A profile row holds a username and nothing
-- else — no email, no collection — so this exposes only what a person chose as
-- their public handle. Writing stays owner-only.
-- ---------------------------------------------------------------------------

drop policy if exists "profiles: read all authenticated" on public.profiles;
create policy "profiles: read all authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Seeing a friend's tradables
--
-- Both halves are required: the other person must be an accepted friend, AND
-- the card must sit in a location they marked tradable. A card in a deck, a box
-- or unsorted stays invisible — location_id is null for unsorted, so the join
-- below excludes it without a special case.
-- ---------------------------------------------------------------------------

drop policy if exists "locations: read friends' tradable" on public.locations;
create policy "locations: read friends' tradable"
  on public.locations for select
  to authenticated
  using (
    is_tradable
    and public.are_friends(user_id, (select auth.uid()))
  );

drop policy if exists "card_instances: read friends' tradable" on public.card_instances;
create policy "card_instances: read friends' tradable"
  on public.card_instances for select
  to authenticated
  using (
    public.are_friends(owner_user_id, (select auth.uid()))
    and exists (
      select 1
        from public.locations l
       where l.id = card_instances.location_id
         and l.is_tradable
    )
  );

-- ---------------------------------------------------------------------------
-- trades and trade_items
--
-- Readable and writable by the two parties only. Note what is NOT granted:
-- there is no UPDATE policy that lets a client set status = 'completed'.
-- Completion happens inside accept_trade() below, because it must happen in the
-- same transaction as the transfer or the log lies.
-- ---------------------------------------------------------------------------

drop policy if exists "trades: read own" on public.trades;
create policy "trades: read own"
  on public.trades for select
  to authenticated
  using (proposer_id = (select auth.uid()) or recipient_id = (select auth.uid()));

drop policy if exists "trades: propose as self" on public.trades;
create policy "trades: propose as self"
  on public.trades for insert
  to authenticated
  with check (
    proposer_id = (select auth.uid())
    and status = 'proposed'
    and public.are_friends(proposer_id, recipient_id)
  );

-- Either side may decline or cancel a trade that has not been settled.
-- 'accepted' and 'completed' are deliberately absent: only accept_trade() may
-- produce them.
drop policy if exists "trades: close own" on public.trades;
create policy "trades: close own"
  on public.trades for update
  to authenticated
  using (
    (proposer_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and status in ('proposed', 'countered')
  )
  with check (status in ('declined', 'cancelled'));

drop policy if exists "trade_items: read own trades" on public.trade_items;
create policy "trade_items: read own trades"
  on public.trade_items for select
  to authenticated
  using (
    exists (
      select 1 from public.trades t
       where t.id = trade_items.trade_id
         and (t.proposer_id = (select auth.uid()) or t.recipient_id = (select auth.uid()))
    )
  );

-- Items may only be added to a trade you proposed, while it is still open.
drop policy if exists "trade_items: write own proposals" on public.trade_items;
create policy "trade_items: write own proposals"
  on public.trade_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.trades t
       where t.id = trade_items.trade_id
         and t.proposer_id = (select auth.uid())
         and t.status in ('proposed', 'countered')
    )
  );

drop policy if exists "trade_items: remove own proposals" on public.trade_items;
create policy "trade_items: remove own proposals"
  on public.trade_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.trades t
       where t.id = trade_items.trade_id
         and t.proposer_id = (select auth.uid())
         and t.status in ('proposed', 'countered')
    )
  );

-- ---------------------------------------------------------------------------
-- ownership_history: readable, never writable from a client
--
-- You can see the history of a transfer you were part of, and — because the
-- feed is the point — of trades between friends. Inserts come only from
-- accept_trade(); the append-only trigger from migration 6 already blocks
-- UPDATE and DELETE for every role including service_role.
-- ---------------------------------------------------------------------------

drop policy if exists "ownership_history: read own and friends'" on public.ownership_history;
create policy "ownership_history: read own and friends'"
  on public.ownership_history for select
  to authenticated
  using (
    to_user_id = (select auth.uid())
    or from_user_id = (select auth.uid())
    or public.are_friends(to_user_id, (select auth.uid()))
    or (from_user_id is not null and public.are_friends(from_user_id, (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- accept_trade()
--
-- The transfer, as one atomic statement.
--
-- SECURITY DEFINER because card_instances RLS forbids any client from changing
-- owner_user_id — which is exactly the property that makes this trustworthy.
-- Everything the caller is allowed to do is re-checked here rather than
-- assumed: that they are the recipient, that the trade is still open, that each
-- item is still owned by the side that offered it, and that the quantities
-- still exist. A trade whose cards moved since it was proposed fails rather
-- than transferring something else.
--
-- Partial stacks split: the source row keeps the remainder, and a new row is
-- created for the new owner. Transferred cards land unsorted (location_id
-- null), because the receiver's binders are not the sender's to choose.
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

  if v_trade.status not in ('proposed', 'countered') then
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
