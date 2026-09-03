-- ---------------------------------------------------------------------------
-- deck_cards — the intended decklist, separate from what is physically sleeved.
--
-- Until now a deck was exactly its contents: whatever cards sat in that
-- container. That is true and useful, but it cannot express the thing a
-- deckbuilder spends most of their time on — the list they are working towards,
-- including cards sitting in a binder and cards they do not own yet.
--
-- So a deck now has two halves, and the difference between them is the whole
-- point:
--
--   * deck_cards       — what the deck is meant to contain.
--   * card_instances   — what is physically in the box, as before.
--
-- Nothing links a list entry to a specific physical copy, deliberately. A list
-- entry says "four Lightning Bolts"; any four Lightning Bolts satisfy it, in
-- any printing. Whether an entry is sleeved is therefore a question you answer
-- by counting, not by following a foreign key that would go stale every time a
-- card moved.
-- ---------------------------------------------------------------------------

create table if not exists public.deck_cards (
  id         uuid primary key default extensions.gen_random_uuid(),

  -- The deck. A CHECK cannot see other tables, so "must be type = 'deck'" is
  -- enforced by the policies below and by the app, not here.
  deck_id    uuid not null references public.locations (id) on delete cascade,

  -- A representative printing: it supplies the name, type line, mana cost and
  -- art the list is drawn with. Availability is counted across every printing
  -- of the same card, so this choice does not narrow what can satisfy the entry.
  card_id    uuid not null references public.cards (scryfall_id) on delete restrict,

  quantity   integer not null default 1 check (quantity > 0 and quantity <= 10000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One entry per printing per deck. Adding the same card again adjusts the
-- quantity rather than growing a second row.
create unique index if not exists deck_cards_deck_card_key
  on public.deck_cards (deck_id, card_id);

create index if not exists deck_cards_deck_idx on public.deck_cards (deck_id);

drop trigger if exists deck_cards_set_updated_at on public.deck_cards;
create trigger deck_cards_set_updated_at
  before update on public.deck_cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: a list entry is readable and writable by whoever owns the deck.
--
-- Ownership is reached through locations, which has its own owner-only policy,
-- so the subquery below is filtered by that policy as well. A deck belonging to
-- someone else simply does not appear in it.
-- ---------------------------------------------------------------------------

alter table public.deck_cards enable row level security;

drop policy if exists "deck_cards: read own" on public.deck_cards;
create policy "deck_cards: read own"
  on public.deck_cards for select
  to authenticated
  using (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id
         and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "deck_cards: write own" on public.deck_cards;
create policy "deck_cards: write own"
  on public.deck_cards for insert
  to authenticated
  with check (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id
         and l.user_id = (select auth.uid())
         and l.type = 'deck'
    )
  );

drop policy if exists "deck_cards: update own" on public.deck_cards;
create policy "deck_cards: update own"
  on public.deck_cards for update
  to authenticated
  using (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists "deck_cards: delete own" on public.deck_cards;
create policy "deck_cards: delete own"
  on public.deck_cards for delete
  to authenticated
  using (
    exists (
      select 1 from public.locations l
       where l.id = deck_cards.deck_id and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill: every card already sleeved becomes a list entry.
--
-- Without this, existing decks would open empty and look destroyed — the cards
-- would still be physically in them, but the list describing them would not
-- exist yet. Quantities are summed per printing, so a deck holding two separate
-- stacks of the same Forest gets one entry for both.
--
-- ON CONFLICT DO NOTHING makes the migration safe to run twice.
-- ---------------------------------------------------------------------------

insert into public.deck_cards (deck_id, card_id, quantity)
select ci.location_id, ci.card_id, sum(ci.quantity)
  from public.card_instances ci
  join public.locations l on l.id = ci.location_id
 where l.type = 'deck'
 group by ci.location_id, ci.card_id
on conflict (deck_id, card_id) do nothing;
