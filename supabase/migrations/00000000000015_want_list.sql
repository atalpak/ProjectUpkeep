-- ---------------------------------------------------------------------------
-- Want list.
--
-- The thing that turns the trade engine from "fill in a form and hope" into
-- something that surfaces opportunities: you mark the cards you are after, and
-- the app tells you which friends already have them sitting in a trade binder.
--
-- An entry names a representative printing for its art and name, but wanting a
-- card is not wanting one printing of it — any Lightning Bolt answers "I want
-- Lightning Bolt". Matching is by oracle id in application code, the same way
-- deck availability and the card locator already work.
--
-- Visibility: your own list is yours to edit, and your friends can read it.
-- That second part is the point — a want list nobody in your circle can see
-- cannot surface anything. It carries only card ids and quantities, never
-- anything about what you own.
-- ---------------------------------------------------------------------------

create table public.want_list (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- A representative printing. RESTRICT so a card cannot vanish from under a
  -- want; the Scryfall sync only ever upserts, so this will not bite.
  card_id    uuid not null references public.cards (scryfall_id) on delete restrict,

  quantity   integer not null default 1 check (quantity > 0 and quantity <= 10000),
  note       text check (note is null or char_length(note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One entry per printing per user; adding the same one again adjusts quantity.
create unique index want_list_user_card_key on public.want_list (user_id, card_id);
create index want_list_user_idx on public.want_list (user_id);

drop trigger if exists want_list_set_updated_at on public.want_list;
create trigger want_list_set_updated_at
  before update on public.want_list
  for each row execute function public.set_updated_at();

alter table public.want_list enable row level security;

-- Read your own, or a friend's. are_friends() is the same security-definer
-- check the tradable-binder policies use (migration 9).
drop policy if exists "want_list: read own and friends'" on public.want_list;
create policy "want_list: read own and friends'"
  on public.want_list for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.are_friends(user_id, (select auth.uid()))
  );

-- Write only your own.
drop policy if exists "want_list: insert own" on public.want_list;
create policy "want_list: insert own"
  on public.want_list for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "want_list: update own" on public.want_list;
create policy "want_list: update own"
  on public.want_list for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "want_list: delete own" on public.want_list;
create policy "want_list: delete own"
  on public.want_list for delete
  to authenticated
  using (user_id = (select auth.uid()));
