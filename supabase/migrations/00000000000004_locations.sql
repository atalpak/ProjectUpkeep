-- ---------------------------------------------------------------------------
-- locations
--
-- User-defined physical containers: "Commander Binder", "Box 3", "Mono-Red
-- deck". This is the half of the product the charter calls the wedge.
--
-- AMENDABILITY NOTE. Phase 0 was skipped, so nesting depth is a guess. The
-- shape here is: an optional parent, with a trigger capping the tree at one
-- level ("Page 4" inside "Binder A"). Both of the plausible corrections are
-- one statement:
--   * people want flat locations  -> drop the column, or just stop offering a
--     parent in the UI
--   * people want deep nesting    -> `drop trigger locations_enforce_nesting on
--     public.locations;` and replace the depth check with a cycle check
-- No business logic below reads `parent_location_id`; it is a display concern
-- only. Keep it that way until interviews say otherwise.
-- ---------------------------------------------------------------------------

create table public.locations (
  id                 uuid primary key default extensions.gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null,

  -- text + CHECK rather than a Postgres enum, throughout this schema. Enums
  -- only grow gracefully (ALTER TYPE ... ADD VALUE); renaming or removing a
  -- value is a migration ordeal. A CHECK constraint is drop-and-recreate. Given
  -- the brief's "build migrations that are easy to amend", that trade favours
  -- CHECK. Same reasoning applies to condition and finish below.
  type               text not null default 'other'
                       check (type in ('deck', 'binder', 'box', 'other')),

  -- ON DELETE SET NULL: deleting "Binder A" promotes its pages to top level
  -- rather than cascading away containers full of someone's cards.
  parent_location_id uuid references public.locations (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint locations_name_length check (char_length(trim(name)) between 1 and 80),
  constraint locations_no_self_parent check (parent_location_id is distinct from id)
);

create index locations_user_id_idx on public.locations (user_id);
create index locations_parent_idx on public.locations (parent_location_id);

-- One "Page 1" per binder, but "Page 1" may exist in several binders. The
-- coalesce gives top-level locations a shared sentinel parent so they compete
-- with each other and not with nested ones.
create unique index locations_unique_name_per_parent
  on public.locations (
    user_id,
    coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Nesting rules: same owner, and at most one level deep.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_location_nesting()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_owner  uuid;
  parent_parent uuid;
begin
  if new.parent_location_id is null then
    return new;
  end if;

  select user_id, parent_location_id
    into parent_owner, parent_parent
    from public.locations
   where id = new.parent_location_id;

  if parent_owner is null then
    raise exception 'parent location % does not exist', new.parent_location_id
      using errcode = 'foreign_key_violation';
  end if;

  if parent_owner <> new.user_id then
    raise exception 'a location cannot be nested inside another user''s location'
      using errcode = 'check_violation';
  end if;

  -- Depth cap. Drop this trigger to allow arbitrary nesting (and add a cycle
  -- check if you do).
  if parent_parent is not null then
    raise exception 'locations support one level of nesting only'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.locations l where l.parent_location_id = new.id) then
    raise exception 'cannot nest a location that already has locations inside it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger locations_enforce_nesting
  before insert or update of parent_location_id, user_id on public.locations
  for each row execute function public.enforce_location_nesting();

-- ---------------------------------------------------------------------------
-- RLS: a location is visible and editable only by the user who owns it.
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;

create policy "locations: read own"
  on public.locations for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "locations: insert own"
  on public.locations for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "locations: update own"
  on public.locations for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "locations: delete own"
  on public.locations for delete
  to authenticated
  using (user_id = (select auth.uid()));
