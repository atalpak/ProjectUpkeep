/**
 * What a keyboard shortcut acts on. The card under the pointer wins, so hover a
 * permanent and press T to tap it with no click first; with nothing hovered it
 * acts on the selection. Zone moves (graveyard, exile, hand, library) also take
 * a hovered card that is not on the table; the table-only actions (tap,
 * counters, groups, copy, delete) only take a hovered permanent, since tapping
 * a card in your hand means nothing.
 */

export type ShortcutTargets = {
  /** For table actions: tap, counters, group, copy, delete. */
  onTable: readonly string[];
  /** For zone moves. */
  movable: readonly string[];
};

export function shortcutTargets(input: {
  hoveredId: string | null;
  battlefield: readonly string[];
  hand: readonly string[];
  selection: readonly string[];
}): ShortcutTargets {
  const { hoveredId, battlefield, hand, selection } = input;
  const hoveredOnTable = hoveredId !== null && battlefield.includes(hoveredId);
  return {
    onTable: hoveredOnTable ? [hoveredId] : selection,
    // Only a card on the table or in the hand counts as "under the pointer". A card
    // that has since moved (its element unmounted, so no pointer-leave ever fired)
    // must not keep catching shortcuts meant for the selection.
    movable: hoveredId !== null && (hoveredOnTable || hand.includes(hoveredId)) ? [hoveredId] : selection,
  };
}
