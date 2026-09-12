/**
 * Turns a deck's list into the flat pile of cards the simulator draws from.
 *
 * A decklist is not a library: it names quantities, not copies, and a real
 * shuffle needs one array element per physical card. This module is also
 * where "designed" and "built" playtesting diverge — the two questions a
 * deck's owner actually asks are different:
 *
 *   - "designed": if I owned every card on this list, how does it play?
 *   - "built": how does it play *right now*, with only what is actually
 *     sleeved?
 *
 * `DeckListEntry.sleeved` answers the second question per *card*, not per
 * printing — see `getDeckList` in `src/lib/collection/queries.ts`, which
 * builds it from `sleevedByCard`, keyed the same way `cardKey` groups
 * printings everywhere else in this app. A deck that lists one card under two
 * printings therefore gets the same `sleeved` total on both entries. Taking
 * `min(quantity, sleeved)` per entry counts that total once per printing
 * instead of once per card, which is exactly the shape of bug that turned a
 * 100-card deck into 114 (migration 20's header). `buildLibrary` groups by
 * `cardKey` first and spends the one shared total across the group's entries
 * in order, capped by each entry's own quantity, so it cannot happen here.
 */

import type { DeckListEntry } from "@/lib/collection/queries";
import { cardKey } from "@/lib/collection/availability";
import type { Card } from "@/lib/types";
import { isLand, parseCost, producedColors, type Color, type ParsedCost } from "@/lib/playtest/mana";

export type PlaytestCard = {
  /** Groups every printing of a card, the same way availability and the
   *  decklist itself do — see `cardKey`. What `cardByTurnOdds` matches on. */
  key: string;
  /** `card.scryfall_id` — a specific printing, not the oracle key `key`
   *  groups by. `key` is what the odds math matches on (every printing
   *  shares one draw probability), but the card preview panel
   *  (`useCardPreview` in CardPanel.tsx) needs an id it can actually fetch,
   *  and an oracle key isn't one. */
  cardId: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  cmc: number;
  land: boolean;
  cost: ParsedCost;
  produces: Color[];
  /** Whether `produces` came from the synced `produced_mana` column rather
   *  than `producedColors`'s basic-land-type fallback — i.e. `card.produced_mana`
   *  was not null. `produces` alone can't say this: an empty result means
   *  either "really produces nothing" or "haven't been told yet," and those
   *  are different things to the colour-screw gate in `present.ts`, which
   *  needs to tell a synced Command Tower apart from one the next Scryfall
   *  sync hasn't reached.
   *
   *  One limit worth knowing: `produced_mana` is null both for a row no sync
   *  has reached *and* for a card Scryfall says taps for nothing at all — a
   *  utility land with no mana ability reads as `false` here forever. The gate
   *  in present.ts therefore treats such a land as unresolved, which errs
   *  toward hiding a number rather than overstating one, and the hint it shows
   *  stops short of promising a re-sync will change it. */
  manaDataKnown: boolean;
  imageUri: string | null;
  /** `card.oracle_text` — the reader panel's whole reason for needing this
   *  type to carry more than an id: `imageUri` is already in memory here,
   *  and so is this, so showing a hand card at a glance costs nothing beyond
   *  what `buildLibrary` already read. */
  oracleText: string | null;
};

export type BuildLibraryOptions = {
  mode: "designed" | "built";
  /** `locations.commander_card_id` — a specific printing, not an oracle id.
   *  The matching entry is pulled out of the library entirely: a commander
   *  starts in the command zone and is never drawn. */
  commanderCardId: string | null;
};

export type BuildLibraryResult = {
  /** One element per physical copy, ready to shuffle. */
  library: PlaytestCard[];
  commander: PlaytestCard | null;
  /** Per-entry shortfall between what the list asks for and what "built"
   *  mode could actually field for it. Always empty in "designed" mode —
   *  that mode plays the list as written, so there is nothing missing. */
  missing: Array<{ card: PlaytestCard; count: number }>;
  /**
   * Copies the brief calls out by name but the return shape it specifies does
   * not carry a field for: entries whose `cards` relation is null (the
   * printing was deleted from `cards` after the list was built) cannot be
   * turned into a `PlaytestCard` at all. Counted here in copies, not entries,
   * so the UI can say "12 cards could not be simulated" rather than silently
   * running a shorter deck. Counted the same way in both modes: it is an
   * upper bound in "built" mode, since a card missing from `cards` cannot be
   * matched to a `sleeved` total either.
   */
  skipped: number;
};

function toPlaytestCard(card: Card): PlaytestCard {
  return {
    key: cardKey(card)!,
    cardId: card.scryfall_id,
    name: card.name,
    typeLine: card.type_line ?? "",
    manaCost: card.mana_cost,
    cmc: card.cmc ?? 0,
    land: isLand(card.type_line),
    cost: parseCost(card.mana_cost),
    produces: producedColors(card),
    manaDataKnown: card.produced_mana != null,
    imageUri: card.image_uri,
    oracleText: card.oracle_text,
  };
}

export function buildLibrary(
  entries: DeckListEntry[],
  opts: BuildLibraryOptions,
): BuildLibraryResult {
  const library: PlaytestCard[] = [];
  const missing: Array<{ card: PlaytestCard; count: number }> = [];
  let commander: PlaytestCard | null = null;
  let skipped = 0;

  const rest: DeckListEntry[] = [];
  for (const entry of entries) {
    if (entry.cards === null) {
      skipped += entry.quantity;
      continue;
    }
    if (opts.commanderCardId && entry.card_id === opts.commanderCardId) {
      commander = toPlaytestCard(entry.cards);
      continue;
    }
    rest.push(entry);
  }

  if (opts.mode === "designed") {
    for (const entry of rest) {
      const card = toPlaytestCard(entry.cards!);
      for (let i = 0; i < entry.quantity; i++) library.push(card);
    }
    return { library, commander, missing, skipped };
  }

  // "built": group by the same key `sleeved` was totalled under, then spend
  // that one total across the group instead of re-reading it per printing.
  const groups = new Map<string, DeckListEntry[]>();
  for (const entry of rest) {
    const key = cardKey(entry.cards)!;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  for (const group of groups.values()) {
    let remaining = group[0].sleeved;
    for (const entry of group) {
      const card = toPlaytestCard(entry.cards!);
      const have = Math.max(0, Math.min(entry.quantity, remaining));
      remaining -= have;
      for (let i = 0; i < have; i++) library.push(card);

      const shortfall = entry.quantity - have;
      if (shortfall > 0) missing.push({ card, count: shortfall });
    }
  }

  return { library, commander, missing, skipped };
}
