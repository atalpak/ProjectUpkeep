-- A profile can now feature several shared decks. Keep the single pinned deck
-- column for older clients, seed the new ordered list from it, and let the
-- profile renderer show only decks its viewer is already allowed to read.
alter table public.profiles
  add column featured_deck_ids uuid[] not null default '{}'
    constraint profiles_featured_deck_limit check (cardinality(featured_deck_ids) <= 5);

update public.profiles
   set featured_deck_ids = array[pinned_deck_id]
 where pinned_deck_id is not null;

comment on column public.profiles.featured_deck_ids is
  'Up to five featured deck IDs in display order. Each deck is shown only when visible under its own RLS policy.';
