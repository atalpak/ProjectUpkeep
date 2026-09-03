-- ---------------------------------------------------------------------------
-- Deck details: notes, a format, and archetype tags.
--
-- A deck is a `locations` row of type 'deck' (migration 4). These columns are
-- meaningful only for decks, but living on `locations` keeps the model flat and
-- costs nothing on a box or binder, which simply leaves them null / empty.
--
-- created_at and updated_at already exist on `locations`, so the "created" and
-- "last updated" the deck page shows need no new column.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists notes  text,
  add column if not exists format text,
  add column if not exists tags   text[] not null default '{}';

-- Bounds. Per-tag length is enforced in the server action (a CHECK cannot
-- iterate an array cleanly); this caps the obvious abuse.
alter table public.locations
  drop constraint if exists locations_notes_len,
  drop constraint if exists locations_format_len,
  drop constraint if exists locations_tags_count;

alter table public.locations
  add constraint locations_notes_len
    check (notes is null or char_length(notes) <= 5000),
  add constraint locations_format_len
    check (format is null or char_length(format) <= 40),
  add constraint locations_tags_count
    check (coalesce(array_length(tags, 1), 0) <= 20);
