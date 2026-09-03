-- ---------------------------------------------------------------------------
-- Card prices.
--
-- The charter cut pricing from v1 (§14, §36) on the grounds that it meant
-- dragging in a pricing engine, and that the budget could not support a paid
-- price API (§52). Both objections are about cost and scope, and neither
-- applies to what this migration does: Scryfall's bulk export already carries
-- prices per printing, we already download it daily, and the USD figures are
-- TCGplayer-derived. The data arrives whether we store it or not.
--
-- Direct TCGplayer or Card Kingdom integration is a different matter and is
-- still out: TCGplayer's API needs approved partner credentials, and Card
-- Kingdom publishes no public price API.
--
-- Prices are a snapshot, not a truth. They move daily, they are one market's
-- view, and `prices_updated_at` records when this row last heard anything so
-- the UI can say how stale a number is rather than implying it is live.
-- ---------------------------------------------------------------------------

alter table public.cards
  -- numeric, not real: money should not be stored in binary floating point,
  -- and totals across a collection would drift if it were. Wide enough for the
  -- cards that cost more than a car.
  add column if not exists price_usd         numeric(12, 2),
  add column if not exists price_usd_foil    numeric(12, 2),
  add column if not exists price_usd_etched  numeric(12, 2),
  add column if not exists price_eur         numeric(12, 2),
  add column if not exists price_eur_foil    numeric(12, 2),

  -- The identifier and deep link for the printing on TCGplayer, so a price can
  -- be checked at source rather than taken on trust.
  add column if not exists tcgplayer_id      integer,
  add column if not exists purchase_uri      text,

  add column if not exists prices_updated_at timestamptz;

comment on column public.cards.price_usd is
  'TCGplayer-derived USD price for the non-foil printing, via Scryfall. A daily snapshot, not a live quote.';
comment on column public.cards.prices_updated_at is
  'When this row last received prices from a sync. Null means never.';

-- Sorting a collection by value, and finding what is worth anything at all.
create index if not exists cards_price_usd_idx
  on public.cards (price_usd desc nulls last);
