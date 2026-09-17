-- ---------------------------------------------------------------------------
-- The deck-list-follows-contents trigger must also fire on a plain quantity
-- change, not just on insert or a location move.
--
-- Migration 16 wired list_card_when_filed_in_deck() to AFTER INSERT and AFTER
-- UPDATE OF location_id, because at the time every way a card's quantity grew
-- inside a deck went through one of those two shapes: a fresh row landing in
-- the deck, or an existing row moving in from elsewhere. Nothing before now
-- ever bumped a card_instances row's quantity *in place* while it was already
-- sitting in a deck.
--
-- The mobile initiative's atomic stack-move function (apply_stack_addition's
-- sibling for moves, added alongside this migration) changes that: sleeving a
-- card into a deck that already holds a matching stack is exactly a quantity-
-- only UPDATE on the existing in-deck row -- location_id does not change,
-- because the row was already there. That update is invisible to both
-- existing triggers, so deck_cards silently under-counts: sleeve a 4th copy
-- into a deck that already lists and holds 3, and the list stays at 3 forever.
--
-- The fix is the missing trigger, not a change to the function itself.
-- list_card_when_filed_in_deck() (migration 20's version) is already safe to
-- fire on a quantity change unmodified: it is monotone-up (it only ever adds a
-- shortfall, never subtracts) and total-comparing (it sums physical vs listed
-- across every printing of the card before deciding whether to touch
-- anything), and it early-returns whenever location_id is null, the location
-- is not a deck, or the physical total does not exceed the listed total. A
-- quantity *decrease* -- the other half of a move, decrementing the source row
-- -- therefore does nothing here, which is correct: the list should not shrink
-- just because copies left the box (removeDeckCard / bulkRemoveEntries own
-- that decision explicitly, per migration 16's header).
-- ---------------------------------------------------------------------------

create trigger card_instances_list_in_deck_on_quantity_change
  after update of quantity on public.card_instances
  for each row
  when (new.quantity is distinct from old.quantity)
  execute function public.list_card_when_filed_in_deck();
