-- Card detail columns.
--
-- Phase 1 stored only what a list row needed: a name, a set, an image. The card
-- panel shows a printing in full, which needs the rest of what Scryfall knows.
--
-- All nullable, all backfilled by the next `npm run sync:scryfall -- --force`.
-- Nothing reads them until that has run, so applying this migration on its own
-- is safe and leaves the app working exactly as before.

alter table public.cards
  -- Cost and colour. `cmc` is Scryfall's converted/mana value, a real because
  -- unset cards genuinely have fractional costs.
  add column if not exists mana_cost        text,
  add column if not exists cmc              real,
  add column if not exists colors           text[],
  add column if not exists color_identity   text[],

  -- Rules text as printed, plus the box that varies by printing.
  add column if not exists oracle_text      text,
  add column if not exists flavor_text      text,
  add column if not exists keywords         text[],

  -- Creature and planeswalker stats. Text, not numeric: power is legitimately
  -- "*", "1+*" or "∞" on real cards.
  add column if not exists power            text,
  add column if not exists toughness        text,
  add column if not exists loyalty          text,

  add column if not exists artist           text,

  -- e.g. "normal", "transform", "modal_dfc", "split". Tells the UI whether
  -- there is a second face to show.
  add column if not exists layout           text,

  -- The faces of a multi-faced card, verbatim from Scryfall: each with its own
  -- name, mana cost, type line, oracle text, stats and image.
  --
  -- Stored as jsonb rather than a `card_faces` table because nothing queries
  -- across faces — the panel reads them as a unit, keyed by the card we already
  -- have. A table would be a join and a migration for no gain.
  add column if not exists card_faces       jsonb,

  -- Scryfall's classification of the set: "expansion", "core", "promo",
  -- "memorabilia", and so on.
  --
  -- Added for the importer. When a pasted line names no set, the resolver has
  -- to choose among every printing of that name, and "newest" lands on The List
  -- or a Secret Lair far more often than on the card someone actually meant.
  -- With this, ordinary printings can be preferred over promos.
  add column if not exists set_type         text;

comment on column public.cards.card_faces is
  'Scryfall card_faces for multi-faced layouts; null for single-faced cards.';
comment on column public.cards.set_type is
  'Scryfall set classification. Used to prefer real expansions over promos.';

-- The importer filters on this on every unqualified name lookup.
create index if not exists cards_set_type_idx on public.cards (set_type);
