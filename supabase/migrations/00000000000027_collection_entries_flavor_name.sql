-- ---------------------------------------------------------------------------
-- collection_entries: project cards.flavor_name too.
--
-- The view (migration 24) predates flavor_name (migration 26) and does not
-- carry it, so the collection page — the single largest consumer of card
-- names in the app — has no way to show a printed name like "Loki's Double"
-- instead of the real name "Spark Double" underneath it.
--
-- Appended at the end rather than next to card_name: CREATE OR REPLACE VIEW
-- requires every existing output column to keep its name, type and position;
-- a new column can only be added after all of them.
-- ---------------------------------------------------------------------------

create or replace view public.collection_entries
with (security_invoker = true) as
select
  ci.id,
  ci.owner_user_id,
  ci.card_id,
  ci.location_id,
  ci.condition,
  ci.finish,
  ci.language,
  ci.quantity,
  ci.notes,
  ci.acquired_at,
  ci.created_at,
  ci.updated_at,

  c.scryfall_id      as card_scryfall_id,
  c.oracle_id        as card_oracle_id,
  c.name             as card_name,
  c.set_code         as card_set_code,
  c.set_name         as card_set_name,
  c.collector_number as card_collector_number,
  c.rarity           as card_rarity,
  c.type_line        as card_type_line,
  c.released_at      as card_released_at,
  c.image_uri        as card_image_uri,
  c.image_uri_small  as card_image_uri_small,
  c.scryfall_uri     as card_scryfall_uri,
  c.available_finishes as card_available_finishes,
  c.lang             as card_lang,
  c.digital          as card_digital,
  c.last_synced_at   as card_last_synced_at,
  c.mana_cost        as card_mana_cost,
  c.cmc              as card_cmc,
  c.colors           as card_colors,
  c.color_identity   as card_color_identity,
  c.oracle_text      as card_oracle_text,
  c.flavor_text      as card_flavor_text,
  c.keywords         as card_keywords,
  c.power            as card_power,
  c.toughness        as card_toughness,
  c.loyalty          as card_loyalty,
  c.artist           as card_artist,
  c.layout           as card_layout,
  c.card_faces       as card_card_faces,
  c.set_type         as card_set_type,
  c.price_usd        as card_price_usd,
  c.price_usd_foil   as card_price_usd_foil,
  c.price_usd_etched as card_price_usd_etched,
  c.price_eur        as card_price_eur,
  c.price_eur_foil   as card_price_eur_foil,
  c.tcgplayer_id     as card_tcgplayer_id,
  c.purchase_uri     as card_purchase_uri,
  c.prices_updated_at as card_prices_updated_at,

  l.name as location_name,
  l.type as location_type,

  case when l.type = 'deck' then 0 else ci.quantity end as available_quantity,

  case ci.finish
    when 'foil'   then coalesce(c.price_usd_foil, c.price_usd)
    when 'etched' then coalesce(c.price_usd_etched, c.price_usd)
    else c.price_usd
  end as display_price,

  -- New: the printed alternate name (migration 26). Appended, not inserted
  -- next to card_name — see the header comment.
  c.flavor_name as card_flavor_name
from public.card_instances ci
join public.cards c on c.scryfall_id = ci.card_id
left join public.locations l on l.id = ci.location_id;

comment on view public.collection_entries is
  'card_instances joined to its printing and container, flattened so the collection page can filter, sort and paginate in the query. security_invoker: RLS on the underlying tables still applies.';

-- CREATE OR REPLACE VIEW does not reset privileges, but re-asserting them
-- costs nothing and keeps this migration correct if that ever changes.
revoke all on public.collection_entries from public, anon;
revoke all on public.collection_entries from authenticated, service_role;
grant select on public.collection_entries to authenticated, service_role;
