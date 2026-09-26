-- A shared traffic gate for calls to Scryfall's search API.
--
-- Catalog search is delegated to api.scryfall.com, which publishes a limit of
-- two search requests per second and a 30-second lockout after a 429. On
-- Vercel every request may run in a different instance, so a per-process
-- counter cannot honour that. One row in Postgres can: each instance asks
-- this function for a time slot before it calls out, and the row hands out
-- slots at least `gap_ms` apart across every instance, and records a cooldown
-- when any instance is told to back off.
--
-- Deliberately narrow: the table holds two timestamps and nothing a user
-- wrote, the functions treat their arguments as untrusted, and there is no cache here — caching
-- public results through a user-callable function would let anyone poison it,
-- so responses are cached by the framework's fetch cache instead.
--
-- RLS is on with no policies, so the table is unreachable directly; only the
-- SECURITY DEFINER functions below can touch it, and only for a signed-in user.

create table public.scryfall_api_gate (
  id            boolean primary key default true check (id),
  next_slot_at  timestamptz not null default now(),
  cooldown_until timestamptz not null default now()
);
alter table public.scryfall_api_gate enable row level security;
insert into public.scryfall_api_gate default values;

-- Reserves the next slot. `granted = false` means the queue is too long (or a
-- cooldown is open) and nothing was reserved; the caller must not call out.
-- `wait_ms` is how long to sleep before calling when granted, or the time
-- until a retry could succeed when not.
create function public.claim_scryfall_slot(gap_ms integer default 600, max_wait_ms integer default 4000)
returns table (granted boolean, wait_ms integer, cooldown_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.scryfall_api_gate;
  now_ts timestamptz := clock_timestamp();
  slot timestamptz;
  wait integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  -- Callers are signed-in users, so their arguments are untrusted: the spacing
  -- is fixed and the queue bound can only be tightened, never widened.
  gap_ms := 600;
  max_wait_ms := least(greatest(max_wait_ms, 0), 4000);

  select * into g from public.scryfall_api_gate where id for update;

  if g.cooldown_until > now_ts then
    return query select false, 0,
      ceil(extract(epoch from (g.cooldown_until - now_ts)) * 1000)::integer;
    return;
  end if;

  slot := greatest(now_ts, g.next_slot_at);
  wait := ceil(extract(epoch from (slot - now_ts)) * 1000)::integer;

  if wait > max_wait_ms then
    return query select false, wait, 0;
    return;
  end if;

  update public.scryfall_api_gate
     set next_slot_at = slot + make_interval(secs => gap_ms / 1000.0)
   where id;
  return query select true, wait, 0;
end;
$$;

-- Opens the shared cooldown after a 429. Any signed-in user can call this, so
-- the length is fixed at 30s (the argument is ignored) and it cannot be
-- re-armed while one is already open: abuse costs at most 30s per half-minute
-- of attention, never an hour-long lockout.
create function public.open_scryfall_cooldown(seconds integer default 30)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.scryfall_api_gate
     set cooldown_until = clock_timestamp() + interval '30 seconds'
   where id and cooldown_until <= clock_timestamp();
end;
$$;

revoke all on function public.claim_scryfall_slot(integer, integer) from public, anon;
revoke all on function public.open_scryfall_cooldown(integer) from public, anon;
grant execute on function public.claim_scryfall_slot(integer, integer) to authenticated;
grant execute on function public.open_scryfall_cooldown(integer) to authenticated;
