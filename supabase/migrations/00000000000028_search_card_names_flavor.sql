-- ---------------------------------------------------------------------------
-- search_card_names returns a sample flavor name too.
--
-- Migration 26 made the WHERE clause match a printed flavor name ("Loki's
-- Double") so searching it finds its real card ("Spark Double"), but the
-- suggestion itself still only ever showed the real name — the dropdown could
-- find the card but not say what is actually printed on it. Mirrors
-- sample_image_uri/sample_card_id: picked from the newest printing of the
-- name, which may itself have no flavor name even when an older printing (or
-- the one that matched the query) did. Same heuristic those two already use.
--
-- CREATE OR REPLACE FUNCTION cannot change a RETURNS TABLE column set, hence
-- the explicit drop before recreating it.
-- ---------------------------------------------------------------------------
drop function if exists public.search_card_names(text, int, boolean);

create or replace function public.search_card_names(
  q text,
  result_limit int default 20,
  include_digital boolean default false
)
returns table (
  name              text,
  printing_count    bigint,
  sample_image_uri  text,
  sample_card_id    uuid,
  sample_flavor_name text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.name,
    count(*) as printing_count,
    (array_agg(c.image_uri_small order by c.released_at desc nulls last))[1] as sample_image_uri,
    (array_agg(c.scryfall_id  order by c.released_at desc nulls last))[1] as sample_card_id,
    (array_agg(c.flavor_name  order by c.released_at desc nulls last))[1] as sample_flavor_name
  from public.cards c
  where (c.name ilike '%' || q || '%' or c.flavor_name ilike '%' || q || '%')
    and (include_digital or not c.digital)
  group by c.name
  order by
    (lower(c.name) like lower(q) || '%') desc,
    char_length(c.name) asc,
    c.name asc
  limit least(greatest(result_limit, 1), 50);
$$;

-- The drop above reset privileges on the function; re-grant exactly what
-- migration 3 originally gave.
grant execute on function public.search_card_names(text, int, boolean) to anon, authenticated;
