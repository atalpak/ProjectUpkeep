-- ---------------------------------------------------------------------------
-- Friend requests belong in the alerts inbox too.
--
-- Migration 14 only ever wrote notifications for trades, so a friend request
-- landed silently — you had to happen to open the friends page to see it. This
-- adds two notification types and a trigger on `friendships` that mirrors
-- `notify_on_trade_change`:
--
--   INSERT (pending)      -> the addressee is told "X sent you a friend request"
--   UPDATE -> 'accepted'  -> the requester is told "X accepted your friend request"
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('trade_proposed', 'trade_accepted', 'trade_declined',
                  'trade_cancelled', 'trade_countered',
                  'friend_request', 'friend_accepted'));

-- What the notification is about, when it is a friendship rather than a trade.
alter table public.notifications
  add column if not exists friendship_id uuid
    references public.friendships (id) on delete cascade;

create or replace function public.notify_on_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    if new.requester_id is distinct from new.addressee_id then
      insert into public.notifications (user_id, actor_id, type, friendship_id)
      values (new.addressee_id, new.requester_id, 'friend_request', new.id);
    end if;

  elsif tg_op = 'UPDATE'
        and new.status = 'accepted'
        and old.status is distinct from 'accepted' then
    if new.addressee_id is distinct from new.requester_id then
      insert into public.notifications (user_id, actor_id, type, friendship_id)
      values (new.requester_id, new.addressee_id, 'friend_accepted', new.id);
    end if;
  end if;

  return null; -- AFTER trigger; return value ignored
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify
  after insert or update on public.friendships
  for each row execute function public.notify_on_friendship_change();
