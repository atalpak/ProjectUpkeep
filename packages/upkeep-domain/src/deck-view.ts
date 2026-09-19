/**
 * How a decklist is grouped on screen: by card type, the commander on its own
 * at the top. Pure and shared, so the mobile app groups a deck the same way the
 * web app does (src/lib/collection/deck-view.ts, which still has its own copy).
 */

export const DECK_SECTIONS = [
  // Not a card type: a commander is a role one card has been given in one
  // deck, so it is never derived from the type line.
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
 * Which section a card belongs to, exactly once, under its most specific type:
 * Land wins outright ("Artifact Land" is a land), Creature beats artifact and
 * enchantment. Double-faced cards carry both faces in one type line ("A // B");
 * the front face decides, matching how the card is cast.
 */
export function sectionFor(typeLine: string | null | undefined): DeckSection {
  const front = (typeLine ?? "").split("//")[0]!.toLowerCase();
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

export type DeckGroup<T> = { section: DeckSection; label: string; rows: T[]; /** Sum of the rows' quantities. */ count: number };

/**
 * Groups list entries into sections in display order, sorted by name within
 * each, leaving out empty sections. The entry whose card is the commander goes
 * to its own first section rather than under its type.
 */
export function groupDeck<T extends { id: string; quantity: number; name: string; typeLine: string | null }>(
  entries: T[],
  commanderEntryId: string | null = null,
): DeckGroup<T>[] {
  const bySection = new Map<DeckSection, T[]>();
  for (const entry of entries) {
    const section: DeckSection = entry.id === commanderEntryId ? "commander" : sectionFor(entry.typeLine);
    const rows = bySection.get(section) ?? [];
    rows.push(entry);
    bySection.set(section, rows);
  }
  return DECK_SECTIONS.flatMap((section) => {
    const rows = bySection.get(section);
    if (!rows?.length) return [];
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return [{ section, label: SECTION_LABELS[section], rows, count: rows.reduce((sum, r) => sum + r.quantity, 0) }];
  });
}
