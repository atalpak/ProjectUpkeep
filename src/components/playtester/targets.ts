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
  exists: (id: string) => boolean;
  selection: readonly string[];
}): ShortcutTargets {
  const { hoveredId, battlefield, exists, selection } = input;
  const hoveredOnTable = hoveredId !== null && battlefield.includes(hoveredId);
  return {
    onTable: hoveredOnTable ? [hoveredId] : selection,
    movable: hoveredId !== null && exists(hoveredId) ? [hoveredId] : selection,
  };
}
