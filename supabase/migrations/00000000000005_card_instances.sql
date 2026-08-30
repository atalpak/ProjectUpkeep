-- ---------------------------------------------------------------------------
-- card_instances
--
-- The owned copies. This is the table that makes the app an inventory system
-- rather than a checklist, and the table Phase 2's atomic trade transfer will
-- act on. Two design constraints came straight from the brief:
--
-- 1. OWNERSHIP AND LOCATION MUST NOT BE COUPLED.
--    `owner_user_id` and `location_id` are two independent, separately
--    updatable columns. There is no composite FK, no owner denormalised onto
--    the row from `locations`, no generated column tying them together. The
--    Phase 2 transfer is therefore exactly:
--
--        update card_instances
--           set owner_user_id = :recipient, location_id = null
--         where id = :instance_id;
--
--    ...and nothing else on the row needs touching. The one rule that does
--    span the two columns is enforced by a trigger, not by the schema shape:
--    you may not park a card in someone else's binder. Setting location_id to
--    null on transfer (which the data model already specifies as the desired
--    behaviour — received cards land "unsorted") satisfies it for free.
--
-- 2. STACKING IS AN UNVALIDATED GUESS, SO DO NOT BAKE IT IN.
--    `quantity` exists per the data model, but there is deliberately NO unique
--    constraint forcing identical cards to merge into one row. Whether two
--    copies of the same NM nonfoil common become quantity=2 or two rows is a
--    *policy*, and it lives in exactly one place in application code:
--    src/lib/collection/stacking.ts. Flipping to strict one-row-per-physical-
--    card is a one-file change with no migration. The index below exists to
--    make the merge lookup fast, not to enforce anything.
-- ---------------------------------------------------------------------------

create table public.card_instances (
  id             uuid primary key default extensions.gen_random_uuid(),

  owner_user_id  uuid not null references auth.users (id) on delete cascade,

  -- ON DELETE RESTRICT: the Scryfall sync must never be able to delete
  -- somebody's collection out from under them by dropping a printing.
  card_id        uuid not null references public.cards (scryfall_id) on delete restrict,

  -- NULL is "unsorted", a real and expected state, not a missing value.
  -- ON DELETE SET NULL so deleting a binder unsorts its cards rather than
  -- destroying them.
  location_id    uuid references public.locations (id) on delete set null,

  condition      text not null default 'NM'
                   check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),

  -- Scryfall's finish vocabulary. Not FK-checked against
  -- cards.available_finishes: that array changes under us on every sync, and a
  -- sync that suddenly invalidated existing rows would be worse than a user
  -- claiming a foil that Scryfall says was never printed. The add/edit form
  -- constrains the choice; the DB constrains the vocabulary.
  finish         text not null default 'nonfoil'
                   check (finish in ('nonfoil', 'foil', 'etched', 'glossy')),

  -- The language of the physical card, which is NOT always the language of the
  -- printing row we synced. Scryfall's `default_cards` export carries one
  -- language per card, so a user who owns the Japanese Lightning Bolt still
  -- points at the English printing row. Storing language on the instance is
  -- what lets them record that truthfully.
  language       text not null default 'en'
                   check (char_length(language) between 2 and 5),

  quantity       integer not null default 1 check (quantity > 0),

  notes          text check (notes is null or char_length(notes) <= 500),

  acquired_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index card_instances_owner_idx    on public.card_instances (owner_user_id);
create index card_instances_location_idx on public.card_instances (location_id);
create index card_instances_card_idx     on public.card_instances (card_id);

-- Supports the "is there already a matching stack?" lookup in
-- src/lib/collection/stacking.ts. Intentionally NOT unique — see note 2 above.
create index card_instances_stack_lookup_idx
  on public.card_instances (owner_user_id, card_id, condition, finish, language, location_id);

create trigger card_instances_set_updated_at
  before update on public.card_instances
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The one cross-column rule: a card can only live in a location its owner owns.
--
-- Phase 2 note: the error text below is the fix. Null the location in the same
-- UPDATE that changes the owner and this never fires.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_instance_location_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  location_owner uuid;
begin
  if new.location_id is null then
    return new;
  end if;

  select user_id into location_owner
    from public.locations
   where id = new.location_id;

  if location_owner is null then
    raise exception 'location % does not exist', new.location_id
      using errcode = 'foreign_key_violation';
  end if;

  if location_owner <> new.owner_user_id then
    raise exception
      'card_instances.location_id must belong to owner_user_id; set location_id to NULL in the same statement that changes ownership'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger card_instances_enforce_location_owner
  before insert or update of location_id, owner_user_id on public.card_instances
  for each row execute function public.enforce_instance_location_owner();

-- ---------------------------------------------------------------------------
-- RLS: your cards, nobody else's.
--
-- Phase 2 will need the trade transaction to move a row from one user to
-- another. Do that in a SECURITY DEFINER function that validates the trade,
-- rather than by loosening these policies — a policy permitting
-- "owner_user_id = auth.uid() OR I am in a trade with the owner" is a much
-- larger blast radius than a single audited function.
-- ---------------------------------------------------------------------------
alter table public.card_instances enable row level security;

create policy "card_instances: read own"
  on public.card_instances for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create policy "card_instances: insert own"
  on public.card_instances for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

-- USING and WITH CHECK both pin the owner, so a user cannot hand a card to
-- someone else (or take one) by editing owner_user_id directly. Phase 2's
-- transfer runs as SECURITY DEFINER and is exempt.
create policy "card_instances: update own"
  on public.card_instances for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy "card_instances: delete own"
  on public.card_instances for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));
