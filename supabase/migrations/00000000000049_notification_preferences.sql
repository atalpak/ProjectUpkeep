-- Settings must control real delivery of future in-app alerts on every device.
-- An absent row preserves today's behavior (all categories on). Filtering at
-- notification insertion lets existing trade/friendship producers remain intact;
-- no trade action or existing inbox entry is changed by muting a category.
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trade_offers boolean not null default true,
  trade_updates boolean not null default true,
  friendships boolean not null default true
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated, service_role;
grant select, insert, update on public.notification_preferences to authenticated;
create policy "notification_preferences: read own" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_preferences: insert own" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_preferences: update own" on public.notification_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Recipient preferences are private: the producer often runs as the other user.
create function public.filter_notification_preferences()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare allowed boolean;
begin
  select case
    when new.type in ('trade_proposed', 'trade_countered') then p.trade_offers
    when new.type in ('trade_accepted', 'trade_declined', 'trade_cancelled') then p.trade_updates
    when new.type in ('friend_request', 'friend_accepted') then p.friendships
    else true
  end into allowed from public.notification_preferences p where p.user_id = new.user_id;
  if allowed is false then return null; end if;
  return new;
end;
$$;
revoke all on function public.filter_notification_preferences() from public, anon, authenticated, service_role;
create trigger notifications_apply_preferences before insert on public.notifications
  for each row execute function public.filter_notification_preferences();
