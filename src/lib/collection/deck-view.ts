/**
 * How a deck is grouped and ordered on screen.
 *
 * Pure, so the fiddly parts — which section a "Legendary Artifact Creature"
 * belongs to, where a colourless card sorts among coloured ones — can be tested
 * without rendering anything.
 */

import type { Card } from "@/lib/types";

/**
 * The least a row needs to be grouped and sorted.
 *
 * Generic because a deck is now two lists over the same shape: the intended
 * decklist, and the cards physically in the box. Both group by type and sort by
 * the same keys, and neither should need its own copy of these rules.
 */
export type GroupableRow = {
  id: string;
  quantity: number;
  cards: Card | null;
};

export const DECK_SECTIONS = [
  // Not a card type: a commander is a role one card has been given in one
  // deck, so it is never derived from the type line. See groupDeck below.
  "commander",
  "planeswalkers",
  "creatures",
  "sorceries",
  "instants",
  "artifacts",
  "enchantments",
  "battles",
  "lands",
  "other",
] as const;

export type DeckSection = (typeof DECK_SECTIONS)[number];

export const SECTION_LABELS: Record<DeckSection, string> = {
  commander: "Commander",
  planeswalkers: "Planeswalkers",
  creatures: "Creatures",
  sorceries: "Sorceries",
  instants: "Instants",
  artifacts: "Artifacts",
  enchantments: "Enchantments",
  battles: "Battles",
  lands: "Lands",
  other: "Other",
};

/**
 * Which section a card belongs to.
 *
 * Order matters here and is not the same as the display order above. A card
 * carries several types at once, and it should appear exactly once, under the
 * most specific one:
 *
 *   - Land wins outright. An "Artifact Land" is a land; nobody looks for Dryad
 *     Arbor under creatures.
 *   - Creature beats artifact and enchantment, so an "Artifact Creature" sits
 *     with the other creatures you can attack with.
 *   - Everything else is unambiguous in practice.
 *
 * Double-faced cards carry both faces in one type line ("A // B"); the front
 * face decides, matching how the card is cast.
 */
export function sectionFor(typeLine: string | null | undefined): DeckSection {
  const front = (typeLine ?? "").split("//")[0].toLowerCase();

  if (front.includes("land")) return "lands";
  if (front.includes("creature")) return "creatures";
  if (front.includes("planeswalker")) return "planeswalkers";
  if (front.includes("battle")) return "battles";
  if (front.includes("instant")) return "instants";
  if (front.includes("sorcery")) return "sorceries";
  if (front.includes("artifact")) return "artifacts";
  if (front.includes("enchantment")) return "enchantments";
  return "other";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const DECK_SORTS = ["name", "manaValue", "rarity", "color"] as const;
export type DeckSort = (typeof DECK_SORTS)[number];

export const DECK_SORT_LABELS: Record<DeckSort, string> = {
  name: "Name",
  manaValue: "Mana value",
  rarity: "Rarity",
  color: "Color",
};

/** Most notable first, which is the order people scan a decklist for. */
const RARITY_RANK: Record<string, number> = {
  mythic: 0,
  special: 1,
  bonus: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

/** WUBRG, the order Magic prints and everyone reads. */
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

/**
 * Colour rank: multicolour first, then mono in WUBRG order, then colourless.
 *
 * Multicolour leading is deliberate — those are the cards whose castability
 * constrains a deck most, so they are what you check first.
 */
export function colorRank(colors: string[] | null | undefined): number {
  const list = (colors ?? []).filter((c) => COLOR_ORDER.includes(c));

  if (list.length > 1) return 0;
  if (list.length === 1) return 1 + COLOR_ORDER.indexOf(list[0]);
  return 1 + COLOR_ORDER.length; // colourless, after every mono colour
}

const nameOf = (row: GroupableRow) => (row.cards?.name ?? "").toLowerCase();

/**
 * Comparator for one sort choice.
 *
 * Every sort falls back to name, so the order is stable and repeatable rather
 * than depending on whatever order the rows arrived in.
 */
export function compareBy<T extends GroupableRow>(sort: DeckSort) {
  return (a: T, b: T): number => {
    const byName = nameOf(a).localeCompare(nameOf(b));

    switch (sort) {
      case "name":
        return byName;

      case "manaValue": {
        // A land has no mana value at all; treat a missing one as 0 so lands do
        // not pile up at the far end of every list.
        const av = a.cards?.cmc ?? 0;
        const bv = b.cards?.cmc ?? 0;
        return av !== bv ? av - bv : byName;
      }

      case "rarity": {
        const ar = RARITY_RANK[a.cards?.rarity ?? ""] ?? 9;
        const br = RARITY_RANK[b.cards?.rarity ?? ""] ?? 9;
        return ar !== br ? ar - br : byName;
      }

      case "color": {
        const ac = colorRank(a.cards?.colors);
        const bc = colorRank(b.cards?.colors);
        return ac !== bc ? ac - bc : byName;
      }
    }
  };
}

export type DeckGroup<T extends GroupableRow = GroupableRow> = {
  section: DeckSection;
  label: string;
  rows: T[];
  /** Cards, not rows — a playset of 4 reads as 4. */
  cardCount: number;
};

/**
 * Groups a deck into sections, sorted within each, dropping empty ones.
 *
 * Sections keep their canonical order rather than being ordered by size: a
 * decklist is read in a familiar shape, and shuffling the headings around
 * because you happen to own more enchantments this week would be worse.
 */
export function groupDeck<T extends GroupableRow>(
  rows: T[],
  sort: DeckSort,
  commanderRowId?: string | null,
  /**
   * Keep the Commander heading even when nothing has been nominated.
   *
   * Every other section is a fact about the cards in the list, so an empty one
   * is just absent. Commander is a decision the deckbuilder has not made yet,
   * and a heading with nothing under it is how the deck says so — an absent
   * section would look like the question had never been asked.
   */
  options: { alwaysIncludeCommander?: boolean } = {},
): Array<DeckGroup<T>> {
  const bySection = new Map<DeckSection, T[]>();

  for (const row of rows) {
    // The nominated commander leaves its type section and heads the list. It is
    // still one physical card in the deck, counted once, just shown apart.
    const section =
      commanderRowId && row.id === commanderRowId
        ? "commander"
        : sectionFor(row.cards?.type_line);

    const group = bySection.get(section);
    if (group) group.push(row);
    else bySection.set(section, [row]);
  }

  const comparator = compareBy<T>(sort);

  return DECK_SECTIONS.filter(
    (section) =>
      bySection.has(section) ||
      (section === "commander" && options.alwaysIncludeCommander === true),
  ).map((section) => {
    const sectionRows = [...(bySection.get(section) ?? [])].sort(comparator);
    return {
      section,
      label: SECTION_LABELS[section],
      rows: sectionRows,
      cardCount: sectionRows.reduce((sum, r) => sum + r.quantity, 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Mana costs
// ---------------------------------------------------------------------------

/**
 * Splits "{2}{G}{G}" into its symbols.
 *
 * Returns the inner text of each: "2", "G", "G". Hybrid and Phyrexian symbols
 * come back whole ("R/G", "U/P") for the renderer to deal with.
 *
 * Only the FIRST face's cost is read. Transform and MDFC layouts already give
 * `cards.mana_cost` as just the front face (see `faceOr` in
 * src/lib/scryfall.ts), but split, adventure and flip layouts pack both halves
 * into one string separated by " // ", e.g. "{2}{R} // {1}{U}" — without this,
 * every adventure creature on a decklist would print a double-width pip run.
 *
 * The tradeoff, deliberately accepted: on a true split card such as
 * Fire // Ice, both halves are independently castable, and this shows only
 * the first — less than the full printed cost — in exchange for the common
 * case (adventures, which vastly outnumber true splits in most decks) not
 * carrying a cost twice as wide as everything else on the list. Product's
 * call; revisit if split cards turn out to matter more than adventures do.
 */
export function manaSymbols(cost: string | null | undefined): string[] {
  if (!cost) return [];
  const [front] = cost.split("//");
  return (front.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1));
}
