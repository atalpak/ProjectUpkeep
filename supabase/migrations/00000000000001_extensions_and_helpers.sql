-- ---------------------------------------------------------------------------
-- Extensions and shared helpers.
-- ---------------------------------------------------------------------------

-- gen_random_uuid()
create extension if not exists "pgcrypto" with schema extensions;

-- Trigram indexes, for card-name search that tolerates typing "bolt" and
-- matching "Lightning Bolt".
create extension if not exists "pg_trgm" with schema extensions;

-- ---------------------------------------------------------------------------
-- Keeps an `updated_at` column honest. Attached per-table below.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
