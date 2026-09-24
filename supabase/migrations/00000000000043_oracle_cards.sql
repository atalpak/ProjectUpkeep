-- ---------------------------------------------------------------------------
-- oracle_cards: one row per card, for the properties of the CARD rather than of
-- a printing.
--
-- WHY THIS EXISTS
--
-- public.cards is one row per printing (~118,000), so everything about the card
-- itself is stored once per printing: measured against production, 38,906
-- distinct oracle ids spread across 118,613 rows. Lightning Bolt's rules text
-- exists in dozens of rows. That costs three ways, and BACKLOG item 1 is the
-- record of the first two:
--
--   * Search indexes. The trigram indexes on type_line and oracle_text (migration
--     33) are 14MB and 53MB because they index every printing's copy of the same
--     text. Over one row per card they are roughly a third of that.
--   * Write cost. A daily sync that touches `cards` pays for every index on
--     every row it writes; the card-level fields are the ones that almost never
--     change and are stored 3x over.
--   * Every card-level feature that follows (rulings, oracle tags, format
--     legality) wants a table keyed by oracle id to hang off.
--
-- This migration is ADDITIVE and only creates the table. Nothing reads it yet,
-- nothing on `cards` changes (no rename, no dropped column, and the trigram
-- indexes on cards stay -- dropping them is a later phase, once a reader has
-- moved). It is fed by scripts/sync-oracle-direct.ts from Scryfall's
-- `oracle_cards` bulk export, over a direct Postgres connection as the
-- scryfall_loader role (migration 44).
--
-- DECISIONS WORTH KNOWING
--
-- No foreign key in either direction between this table and `cards`. Scryfall's
-- two files disagree: 216 oracle ids that appear on printings in
-- `default_cards` are absent from `oracle_cards` (Alchemy rebalances, mostly).
-- A foreign key would make the sync of one file fail on the state of the
-- other, so every join from cards to this table is a LEFT join, and a reader
-- has to cope with a printing that has no oracle row.
--
-- Columns are typed exactly like their namesakes on `cards` (cmc real, colors
-- text[], ...) and the loader derives them with the same front-face fallback as
-- toCardRow (src/lib/scryfall-oracle.ts), so a double-faced card reads the same
-- from either table.
--
-- `legalities` is COMPACT jsonb: {format: status} with every `not_legal` entry
-- OMITTED. Scryfall sends ~25 formats per card, mostly not_legal, so the full
-- object is mostly noise repeated 39,000 times. A MISSING KEY MEANS
-- NOT LEGAL (or a format Scryfall did not list) -- never "unknown, ask again".
-- Any reader must treat absence as not legal. Statuses present are legal,
-- restricted and banned.
--
-- `content_hash` is the loader's fingerprint of the row (see hashOracleRow) so
-- it can write only what changed, the same idea as cards.content_hash; opaque
-- to the database, deliberately not indexed. `updated_at` is when the row was
-- last WRITTEN, not when Scryfall last published.
--
-- Size, measured by loading today's real oracle_cards export (38,690 cards)
-- into a scratch Postgres 16: heap 22MB, primary key 1.2MB, type_line trigram
-- 5.8MB, oracle_text trigram 14MB -- 44MB in all, against a production
-- database of 344MB and the 500MB free-tier limit (~390MB after this lands).
-- The ~67MB the cards trigram indexes hold is what a later phase recovers
-- once a reader has moved.
--
-- ACCESS
--
-- Same shape as `cards`: readable by everyone, writable by no client. This
-- schema hands every new table to anon, authenticated and service_role by
-- default privilege (see migration 24's header for the last time that
-- mattered), and RLS alone is a single line of defence, so the grants are also
-- taken back: revoke everything, give select back. The one writer is the
-- scryfall_loader role, whose grants and policies are in migration 44.
--
-- service_role is revoked from writing too, on purpose and not by oversight:
-- it bypasses RLS, so its write grant would be the only thing between the
-- service key and this table, and nothing needs it. The printings sync
-- (scripts/sync-scryfall.ts, service key) never touches oracle_cards, and a
-- unit test (scripts/scryfall-oracle.test.ts) fails if it ever starts to.
-- ---------------------------------------------------------------------------

create table public.oracle_cards (
  oracle_id       uuid primary key,
  name            text not null,
  mana_cost       text,
  cmc             real,
  type_line       text,
  oracle_text     text,
  colors          text[],
  color_identity  text[],
  keywords        text[],
  power           text,
  toughness       text,
  loyalty         text,
  produced_mana   text[],
  -- Null until synced, not false: same reasoning as cards.game_changer
  -- (migration 34), and the same value the loader would write for a printing.
  game_changer    boolean,
  layout          text,
  legalities      jsonb not null default '{}'::jsonb,
  content_hash    text not null,
  updated_at      timestamptz not null default now()
);

comment on table public.oracle_cards is
  'One row per Scryfall oracle_id: the card-level properties, loaded from the oracle_cards bulk export. No foreign key to or from cards -- the two exports disagree (216 oracle ids on printings are missing here), so join with LEFT JOIN.';
comment on column public.oracle_cards.legalities is
  'Compact format -> status map. Entries whose status is not_legal are OMITTED: a missing key means not legal. Present statuses are legal, restricted, banned.';
comment on column public.oracle_cards.content_hash is
  'Loader fingerprint of every other loaded column. Opaque to the database; scripts/sync-oracle-direct.ts writes only rows whose hash differs.';
comment on column public.oracle_cards.updated_at is
  'When this row was last written by the loader. Not when Scryfall last changed the card.';

-- The same indexes `cards` carries for Advanced Search (migration 33), over one
-- row per card. They stay on `cards` too until a reader moves.
create index oracle_cards_type_line_trgm_idx
  on public.oracle_cards using gin (type_line extensions.gin_trgm_ops);
create index oracle_cards_oracle_text_trgm_idx
  on public.oracle_cards using gin (oracle_text extensions.gin_trgm_ops);

alter table public.oracle_cards enable row level security;

create policy "oracle_cards: readable by everyone"
  on public.oracle_cards for select
  to anon, authenticated
  using (true);

-- No write policies for clients, and no write grants either.
revoke all on public.oracle_cards from public, anon, authenticated, service_role;
grant select on public.oracle_cards to anon, authenticated, service_role;
