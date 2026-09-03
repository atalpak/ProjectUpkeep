/**
 * Folding resolved import rows into a set of decklist changes.
 *
 * The collection importer files physical copies, each with a condition, finish,
 * language and location — see src/lib/import/plan.ts. A decklist entry has none
 * of that: it names a printing and how many the deck wants. So this sums
 * duplicate lines *by printing* (two "Forest (FDN) 703" lines are one entry;
 * "Forest (FDN) 703" and "Forest (M21) 250" stay two, one row per printing),
 * keeps the failures for reporting, and — given what the deck already lists —
 * says how many entries are new versus merged.
 *
 * Pure on purpose: the database round trips are the server action's job, this
 * is testable against fabricated rows.
 */

import type { ResolvedRow } from "@/lib/import/resolve";

export type DeckImportLine = {
  /** First input line this printing appeared on, for display. */
  line: number;
  /** cards.scryfall_id — the printing this decklist entry names. */
  cardId: string;
  name: string;
  /** "Name · SET #123" for this printing. */
  matched: string;
  setCode: string | null;
  imageUri: string | null;
  /** Summed across every line that resolved to this same printing. */
  quantity: number;
};

export type DeckImportPlan = {
  /** One per distinct printing, in first-seen order. */
  lines: DeckImportLine[];
  /** Sum of every line's quantity. */
  totalCards: number;
  /** Rows that matched no card, echoed back so they can be fixed. */
  unmatched: Array<{ line: number; raw: string; reason: string }>;
};

export function planDeckImport(resolved: ResolvedRow[]): DeckImportPlan {
  const byPrinting = new Map<string, DeckImportLine>();
  const unmatched: DeckImportPlan["unmatched"] = [];

  for (const row of resolved) {
    if (!row.card) {
      unmatched.push({
        line: row.line,
        raw: row.raw,
        reason: row.reason ?? "No matching card.",
      });
      continue;
    }

    const card = row.card;
    const existing = byPrinting.get(card.scryfall_id);
    if (existing) {
      existing.quantity += row.quantity;
      continue;
    }

    byPrinting.set(card.scryfall_id, {
      line: row.line,
      cardId: card.scryfall_id,
      name: card.name,
      matched: `${card.name} · ${card.set_code.toUpperCase()} #${card.collector_number}`,
      setCode: card.set_code,
      imageUri: card.image_uri_small,
      quantity: row.quantity,
    });
  }

  const lines = [...byPrinting.values()];
  return {
    lines,
    totalCards: lines.reduce((sum, line) => sum + line.quantity, 0),
    unmatched,
  };
}

/**
 * Against the printings the deck already lists, how many import lines land on an
 * existing entry — quantity added on top — versus a fresh one.
 */
export function splitAgainstDeck(
  lines: DeckImportLine[],
  existingCardIds: Iterable<string>,
): { newEntries: number; mergedEntries: number } {
  const have = new Set(existingCardIds);
  let newEntries = 0;
  let mergedEntries = 0;

  for (const line of lines) {
    if (have.has(line.cardId)) mergedEntries += 1;
    else newEntries += 1;
  }

  return { newEntries, mergedEntries };
}
