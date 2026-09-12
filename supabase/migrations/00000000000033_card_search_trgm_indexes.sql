-- ---------------------------------------------------------------------------
-- Trigram indexes for Advanced Search's type-line and oracle-text substring
-- filters.
--
-- Advanced Search (src/lib/cards/search.ts) runs `ilike '%word%'` against
-- `cards.type_line` and `cards.oracle_text` to answer things like
-- "t:planeswalker" or "o:draw a card". Neither column had a supporting
-- index — migration 3 gave `name` one, but type_line and oracle_text were
-- added two migrations later (card_details) and never got the same
-- treatment. A query as narrow as "every planeswalker" forced a sequential
-- scan over every printing in the table and reliably hit Postgres's
-- statement timeout rather than ever returning — reported live as "t:planeswalker
-- loy=7 doesn't find anything", which was actually the query timing out and
-- searchCards() swallowing the error into an empty result rather than a bug
-- in the loyalty filter itself.
--
-- Same fix as migration 3's cards_name_trgm_idx: a trigram GIN index turns an
-- unanchored ILIKE into an index scan instead of a table scan.
-- ---------------------------------------------------------------------------

create index cards_type_line_trgm_idx on public.cards using gin (type_line extensions.gin_trgm_ops);
create index cards_oracle_text_trgm_idx on public.cards using gin (oracle_text extensions.gin_trgm_ops);
