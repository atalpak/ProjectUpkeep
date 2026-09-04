-- ---------------------------------------------------------------------------
-- A flat, queryable view of the collection.
--
-- WHY THIS EXISTS
--
-- The collection page fetched every row a user owned (up to 20,000), filtered
-- and sorted them in JavaScript, and paginated in the browser. On a 688-entry
-- collection that shipped 1.7MB to draw 50 rows, and it put a hard ceiling on
-- how large a collection the product can serve at all.
--
-- Moving that work into the query runs into a PostgREST limit: a request
-- against card_instances with cards embedded cannot ORDER BY a column of the
-- embedded table. Sorting a collection by card name — the most obvious thing
-- anyone does — is therefore not expressible against the base table.
--
-- A view makes every column top-level, so filtering, ordering and range
-- pagination all work normally, with an exact count. Nothing is stored: this is
-- a query, named.
--
-- SECURITY
--
-- `security_invoker = true` (Postgres 15+; we are on 17) makes the view run
-- with the privileges and RLS of the caller rather than the owner. Without it a
-- view is a hole straight through row-level security: it would return every
-- user's cards to anyone who selected from it. The existing policies on
-- card_instances, cards and locations therefore still apply, unchanged, and
-- this view adds no new access — it only reshapes what the caller could
-- already read.
--
-- The join to cards is inner: card_id is NOT NULL with a foreign key, so a row
-- without its printing cannot exist. The join to locations is left: a null
-- location_id is "unsorted", a real and expected state.
-- ---------------------------------------------------------------------------

create or replace view public.collection_entries
with (security_invoker = true) as
select
  -- The instance. Named exactly as on card_instances so the app can reshape a
  -- flat row back into its nested form without a translation table.
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

  -- The printing. Prefixed, because `name` and `id` would otherwise collide
  -- with the instance's and with the location's.
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

  -- The container, or nulls when the stack is unsorted.
  l.name as location_name,
  l.type as location_type,

  -- Two columns the table shows by default and therefore needs to sort by.
  -- Both are derived, so without them here the page would have to fall back to
  -- sorting the whole collection in memory — the exact thing this view exists
  -- to avoid.
  --
  -- Free copies: a copy is committed only if it is itself sitting in a deck.
  -- Mirrors the `available` column's sortBy in src/components/collection/columns.ts.
  case when l.type = 'deck' then 0 else ci.quantity end as available_quantity,

  -- The price actually shown for this stack, which depends on its finish.
  -- Mirrors displayPrice() in src/lib/collection/pricing.ts, including its
  -- fallback: a foil with no foil price displays the non-foil figure (flagged
  -- as approximate in the UI), and glossy is priced as non-foil.
  case ci.finish
    when 'foil'   then coalesce(c.price_usd_foil, c.price_usd)
    when 'etched' then coalesce(c.price_usd_etched, c.price_usd)
    else c.price_usd
  end as display_price
from public.card_instances ci
join public.cards c on c.scryfall_id = ci.card_id
left join public.locations l on l.id = ci.location_id;

comment on view public.collection_entries is
  'card_instances joined to its printing and container, flattened so the collection page can filter, sort and paginate in the query. security_invoker: RLS on the underlying tables still applies.';

-- The view is reachable by signed-in users only; RLS on the base tables does
-- the actual restricting.
--
-- Both statements matter. Default privileges in this schema grant everything on
-- a new object to `authenticated`, so without the second revoke the view would
-- carry INSERT/UPDATE/DELETE/TRUNCATE as well as SELECT. A view over a join is
-- not auto-updatable, so those writes would fail at runtime — but "it happens
-- to error" is not an access rule, and a later change to the view's shape could
-- quietly make it one.
revoke all on public.collection_entries from public, anon;
revoke all on public.collection_entries from authenticated, service_role;
grant select on public.collection_entries to authenticated, service_role;

-- Sorting by card name and by set are the two the table does by default, and
-- both are ORDER BY over a join. These make that ordering cheap enough to do
-- per page rather than per collection.
create index if not exists cards_name_idx on public.cards (name);
create index if not exists cards_set_code_number_idx on public.cards (set_code, collector_number);
