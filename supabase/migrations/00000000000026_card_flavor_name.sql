-- ---------------------------------------------------------------------------
-- flavor_name: the printed alternate name on Universes Beyond crossovers.
--
-- Marvel, LOTR: Tales of Middle-earth, Fallout, Final Fantasy, Avatar, the
-- Godzilla alt-arts in Ikoria, and several Secret Lair drops print an
-- in-universe name over the real card — e.g. the card printed as "Loki's
-- Double" is, by rules text and `name`, "Spark Double". Scryfall carries both:
-- `name` is unchanged (the actual game name), `flavor_name` is what is on the
-- card. Neither our schema nor the sync job stored the second one, so any
-- import whose source (ManaBox, a decklist paste) used the printed name had no
-- way to match it — it was silently dropped as "no card with that name."
--
-- Nullable: the overwhelming majority of printings have no flavor name at all.
-- ---------------------------------------------------------------------------

alter table public.cards
  add column if not exists flavor_name text;

-- Mirrors cards_name_lower_idx: the import resolver looks up by
-- lower(flavor_name) exactly the way it already does for lower(name).
create index if not exists cards_flavor_name_lower_idx
  on public.cards (lower(flavor_name))
  where flavor_name is not null;

-- ---------------------------------------------------------------------------
-- search_card_names now also matches the printed flavor name, so typing
-- "Loki's Double" into the manual add-a-card search finds the row even though
-- its real name is "Spark Double" — same reasoning as the import fix above,
-- for the other place a person types a card name. Still grouped and returned
-- by the real `name`: that is the identity "how many do I own" aggregates on
-- elsewhere, and changing that would be a much bigger change than this bug
-- needs.
-- ---------------------------------------------------------------------------
create or replace function public.search_card_names(
  q text,
  result_limit int default 20,
  include_digital boolean default false
)
returns table (
  name              text,
  printing_count    bigint,
  sample_image_uri  text,
  sample_card_id    uuid
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
    (array_agg(c.scryfall_id  order by c.released_at desc nulls last))[1] as sample_card_id
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
