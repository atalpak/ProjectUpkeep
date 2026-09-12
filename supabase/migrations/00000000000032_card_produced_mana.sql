-- Which colours a land (or mana-producing permanent) actually taps for.
--
-- The playtest lab needs to answer "do I have the right colours" for a hand,
-- and inferring that from oracle text is unreliable: "{T}: Add one mana of
-- any color" and "{T}: Add {C}" read nothing alike, dual lands phrase their
-- ability a dozen different ways, and a land with no rules text at all (a
-- basic) produces mana purely by being a Plains. Scryfall already resolves all
-- of this into `produced_mana`, so store it rather than re-deriving it from
-- text the collection panel already displays as prose, not data.
--
-- Nullable, additive, backfilled by the next `npm run sync:scryfall -- --force`
-- like every other detail column since migration 7. Nothing reads it until
-- that sync has run — the simulator's own fallback (basic land types read off
-- `type_line`) covers a row that has not been resynced yet — so applying this
-- migration on its own changes nothing about how the app behaves today.

alter table public.cards
  add column if not exists produced_mana text[];

comment on column public.cards.produced_mana is
  'Scryfall produced_mana: the colours (plus C for colourless) this card can tap for. Null until the next sync; the playtest engine falls back to basic land types in that case.';
