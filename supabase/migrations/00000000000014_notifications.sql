-- ---------------------------------------------------------------------------
-- Notifications.
--
-- A trade system nobody gets told about does not get used. This adds an
-- in-app inbox: a row per thing that happened to you — an offer arrived, an
-- offer you sent was accepted, declined, cancelled or countered.
--
-- Rows are written by a trigger on `trades`, never by the app, so no code path
-- can forget to notify and none can forge a notification for someone else. RLS
-- lets you read and mark-read your own, and nothing else.
--
-- Email is deliberately not here. It needs an outbound mail provider and a
-- sending domain, neither of which the project has yet; the trigger is the
-- seam where it would hook in later.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id         uuid primary key default extensions.gen_random_uuid(),

  -- Who should see this.
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- Who caused it. Null if they have since deleted their account.
  actor_id   uuid references auth.users (id) on delete set null,

  type       text not null
               check (type in ('trade_proposed', 'trade_accepted',
                               'trade_declined', 'trade_cancelled',
                               'trade_countered')),

  -- The trade it is about. Cascades: a hard-deleted trade takes its
  -- notifications with it, and trades are only ever soft-closed anyway.
  trade_id   uuid references public.trades (id) on delete cascade,

  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_inbox_idx
  on public.notifications (user_id, created_at desc);

-- Partial index for the unread count in the nav — the query run on every page.
create index notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- You can read your own.
create policy "notifications: read own"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

-- You can mark your own read. WITH CHECK pins user_id so the update cannot be
-- used to hand a notification to someone else; the app only ever sets read_at.
create policy "notifications: mark own read"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- You can clear your own.
create policy "notifications: delete own"
  on public.notifications for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT policy: rows come only from the trigger below, which runs as the
-- function owner and so is not subject to these policies.

-- ---------------------------------------------------------------------------
-- notify_on_trade_change()
--
-- One trigger covering the whole trade lifecycle.
--
--   INSERT  — a new offer. If it carries countered_from it *is* a counter, so
--             it is announced as one (and linked to itself, the actionable
--             row) rather than as a plain proposal.
--   UPDATE  — a status change. 'countered' is not handled here: the counter's
--             own INSERT already notified, with the better link. 'accepted'
--             is never set directly (only accept_trade sets 'completed').
--
-- actor is auth.uid() where the change came from a signed-in request; the
-- coalesce fallbacks keep it sensible if a trigger ever fires outside one.
-- A notification is never written when the actor would be its own recipient.
-- ---------------------------------------------------------------------------

create or replace function public.notify_on_trade_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_actor  uuid;
  v_type   text;
begin
  if tg_op = 'INSERT' then
    v_target := new.recipient_id;
    v_actor  := new.proposer_id;
    v_type   := case when new.countered_from is not null
                     then 'trade_countered' else 'trade_proposed' end;

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'completed' then
      v_target := new.proposer_id;
      v_actor  := coalesce(auth.uid(), new.recipient_id);
      v_type   := 'trade_accepted';
    elsif new.status = 'declined' then
      v_target := new.proposer_id;
      v_actor  := coalesce(auth.uid(), new.recipient_id);
      v_type   := 'trade_declined';
    elsif new.status = 'cancelled' then
      v_target := new.recipient_id;
      v_actor  := coalesce(auth.uid(), new.proposer_id);
      v_type   := 'trade_cancelled';
    else
      return null; -- 'countered', 'accepted': nothing to do here
    end if;

  else
    return null;
  end if;

  if v_target is distinct from v_actor then
    insert into public.notifications (user_id, actor_id, type, trade_id)
    values (v_target, v_actor, v_type, new.id);
  end if;

  return null; -- AFTER trigger; return value is ignored
end;
$$;

create trigger trades_notify_on_insert
  after insert on public.trades
  for each row execute function public.notify_on_trade_change();

create trigger trades_notify_on_status_change
  after update on public.trades
  for each row execute function public.notify_on_trade_change();
