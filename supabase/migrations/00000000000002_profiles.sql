-- ---------------------------------------------------------------------------
-- profiles
--
-- The data model sketches a `users` table with id/username/email/created_at.
-- Supabase Auth already owns identity (auth.users holds the id, email, and
-- created_at), and the brief says not to hand-roll auth tables. So the only
-- thing left for us to store is the app-level bit Auth does not have: a
-- username. `profiles` is that table, keyed 1:1 to auth.users.
--
-- Every user-owned table below therefore points its FK at auth.users(id), not
-- at profiles — profiles is decoration on identity, not identity itself.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 3 and 32),
  -- Letters, numbers, underscore, hyphen. Deliberately narrow: Phase 2 trading
  -- will let people find each other by username, and ambiguous lookalikes are a
  -- social-engineering vector in a trading app.
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_-]+$')
);

create unique index profiles_username_key on public.profiles (lower(username));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile whenever Supabase Auth creates a user, so there is
-- never a signed-in user without a profile row.
--
-- The signup form passes a username through `options.data`, which lands in
-- raw_user_meta_data. If it is missing or already taken we fall back to a
-- generated name rather than failing the signup — a user with an ugly username
-- can rename themselves; a user whose signup 500s cannot.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  candidate text;
begin
  requested := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if requested is null or requested !~ '^[A-Za-z0-9_-]{3,32}$' then
    requested := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  candidate := requested;

  -- Suffix on collision. Bounded loop; after 25 tries fall back to the uuid.
  for i in 1..25 loop
    exit when not exists (
      select 1 from public.profiles p where lower(p.username) = lower(candidate)
    );
    candidate := substr(requested, 1, 27) || '_' || i::text;
  end loop;

  if exists (select 1 from public.profiles p where lower(p.username) = lower(candidate)) then
    candidate := 'player_' || replace(new.id::text, '-', '');
  end if;

  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Own-profile only for now. Phase 2 (trading) will need users to look each
-- other up by username; widen with an additional SELECT policy then rather
-- than opening the table up before anything needs it.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
