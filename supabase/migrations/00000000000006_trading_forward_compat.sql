-- ---------------------------------------------------------------------------
-- Phase 2 forward-compatibility: trades, trade_items, ownership_history.
--
-- ***** THESE TABLES ARE NOT IN USE. *****
--
-- The Phase 1 brief permits creating them now for forward-compatibility and
-- explicitly forbids building logic or UI against them. Nothing in src/ reads
-- or writes them, and RLS is enabled with NO POLICIES, so they are deny-all to
-- every end user until Phase 2 deliberately opens them up. That is the
-- enforcement mechanism for "don't build against these yet": you cannot,
-- accidentally, from the app.
--
-- They exist here so that the Phase 2 session inherits FK targets and a
-- settled audit-log shape rather than starting from a blank schema. Phase 1
-- writes nothing to them, including on manual collection adds — that is Phase
-- 2's call to make, along with whether pre-trading history is worth
-- backfilling.
-- ---------------------------------------------------------------------------

create table public.trades (
  id           uuid primary key default extensions.gen_random_uuid(),
  proposer_id  uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'proposed'
                 check (status in ('proposed', 'countered', 'accepted',
                                   'declined', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint trades_distinct_parties check (proposer_id <> recipient_id)
);

create index trades_proposer_idx  on public.trades (proposer_id, status);
create index trades_recipient_idx on public.trades (recipient_id, status);

create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

create table public.trade_items (
  id               uuid primary key default extensions.gen_random_uuid(),
  trade_id         uuid not null references public.trades (id) on delete cascade,

  -- RESTRICT, not CASCADE: a card that is committed to an open trade must not
  -- vanish because someone deleted it from their collection mid-negotiation.
  -- Phase 2 should surface that as "cancel the trade first", which this
  -- constraint makes unavoidable rather than optional.
  card_instance_id uuid not null references public.card_instances (id) on delete restrict,

  direction        text not null
                     check (direction in ('from_proposer', 'from_recipient')),

  -- Supports trading part of a stack. The open question the data model flags —
  -- how to trade 3 of 5 copies — is a split-then-transfer inside the Phase 2
  -- transaction: decrement the source row's quantity, insert a new row for the
  -- traded portion owned by the recipient with location_id null. Nothing in
  -- this schema blocks that approach.
  quantity         integer not null default 1 check (quantity > 0),

  created_at       timestamptz not null default now()
);

create index trade_items_trade_idx    on public.trade_items (trade_id);
create index trade_items_instance_idx on public.trade_items (card_instance_id);

-- ---------------------------------------------------------------------------
-- ownership_history — append-only audit log.
--
-- The data model calls this "what makes the transfer trustworthy". An audit log
-- you can quietly edit is not an audit log, so the guard below is a trigger
-- rather than a convention: UPDATE and DELETE always raise, for every role
-- including the service role.
--
-- None of card_instance_id, from_user_id or to_user_id is a foreign key. An
-- audit record must outlive the rows it describes: a CASCADE would erase the
-- history along with a deleted card or a closed account, a RESTRICT would make
-- those deletions impossible, and SET NULL would quietly corrupt the record.
-- The cost is that these ids can dangle, which is the correct trade for a log.
-- trade_id is the exception — trades are never hard-deleted (they end in a
-- terminal status), so the FK there is free.
-- ---------------------------------------------------------------------------
create table public.ownership_history (
  id               uuid primary key default extensions.gen_random_uuid(),
  card_instance_id uuid not null,
  from_user_id     uuid,                                                  -- null = newly created instance
  to_user_id       uuid not null,
  trade_id         uuid references public.trades (id) on delete set null, -- null = manual add/edit, not a trade
  transferred_at   timestamptz not null default now()
);

create index ownership_history_instance_idx on public.ownership_history (card_instance_id, transferred_at);
create index ownership_history_to_user_idx  on public.ownership_history (to_user_id, transferred_at desc);

create or replace function public.reject_ownership_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ownership_history is append-only; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger ownership_history_is_append_only
  before update or delete on public.ownership_history
  for each row execute function public.reject_ownership_history_mutation();

-- ---------------------------------------------------------------------------
-- RLS enabled, no policies: deny-all for anon and authenticated. Phase 2 adds
-- the policies it needs. Do not add them here.
-- ---------------------------------------------------------------------------
alter table public.trades            enable row level security;
alter table public.trade_items       enable row level security;
alter table public.ownership_history enable row level security;
