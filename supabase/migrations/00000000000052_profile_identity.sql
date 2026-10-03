-- A small, opt-in identity layer. Profiles are already readable by authenticated
-- members (migration 9), so these columns contain only details a user chooses
-- to put on their signed-in-member profile. Email and collection data stay out.
alter table public.profiles
  add column bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 160),
  add column avatar_style text not null default 'slate'
    constraint profiles_avatar_style check (avatar_style in ('amber', 'sage', 'slate', 'plum', 'rust')),
  add column favorite_formats text[] not null default '{}'
    constraint profiles_favorite_formats check (
      cardinality(favorite_formats) <= 3
      and favorite_formats <@ array['Commander', 'Standard', 'Modern', 'Pioneer', 'Pauper', 'Limited', 'Legacy', 'Vintage']::text[]
    ),
  add column favorite_colors text[] not null default '{}'
    constraint profiles_favorite_colors check (
      cardinality(favorite_colors) <= 5
      and favorite_colors <@ array['W', 'U', 'B', 'R', 'G']::text[]
    ),
  add column pinned_deck_id uuid references public.locations (id) on delete set null;

comment on column public.profiles.pinned_deck_id is
  'Optional featured deck. The profile renderer displays it only when its deck is visible to the current viewer.';
