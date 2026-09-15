-- Scryfall's `game_changer` flag: cards the Commander Rules Committee has
-- named as warranting extra scrutiny at a table (the 2024 banned-list
-- companion list — Sol Ring is not one, Mana Drain is).
--
-- The playtest lab and deck banner want to say "this decklist runs N game
-- changers" so a pod can agree on power level before shuffling up. Same
-- nullability story as produced_mana (migration 32) and the price columns
-- before it: `false` and "Scryfall hasn't told us yet" are different facts,
-- and collapsing them into `false` would make an unsynced deck look tame
-- rather than unknown. Nullable, backfilled by the next
-- `npm run sync:scryfall -- --force`; nothing reads it until then, so this
-- migration alone changes no behaviour.

alter table public.cards
  add column if not exists game_changer boolean;

comment on column public.cards.game_changer is
  'Scryfall game_changer: true for cards on the Commander Game Changers list. Null until the next sync, not false — the deck banner hides the stat rather than reporting zero.';
