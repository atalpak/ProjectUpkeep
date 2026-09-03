/**
 * Folding resolved import rows into a set of decklist changes.
 *
 * The collection importer files physical copies, each with a condition, finish,
 * language and location — see src/lib/import/plan.ts. A decklist has none of
 * that: an entry names a card (a printing, really) and how many the deck wants.
 * So this is the whole plan for a deck import — sum duplicate lines by printing,
 * keep the failures for reporting, and (given what the deck already lists) say
 * how many entries are new versus merged.
 *
 * Pure on purpose: the database round trips are the server action's job, this
 * is testable against fabricated rows.
 */

import type { ResolvedRow } from "@/lib/import/resolve";

export type DeckImportLine = {
  /** First input line this card appeared on, for display. */
  line: number;
  /**
   * A representative printing's cards.scryfall_id — the one a new deck_cards
   * row would point at. Lines are folded by card *name*, not by printing (a
   * decklist wants "Forest", not one specific Forest), so this is just the
   * first printing seen for the name.
   */
  cardId: string;
  name: string;
  /** "Name · SET #123" for the representative printing. */
  matched: string;
  setCode: string | null;
  imageUri: string | null;
  /** Summed across every line that resolved to this card, any printing. */
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

/** The key two lines share when they are "the same card" for a decklist. */
export const deckImportKey = (name: string) => name.trim().toLowerCase();

export function planDeckImport(resolved: ResolvedRow[]): DeckImportPlan {
  const byName = new Map<string, DeckImportLine>();
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
    // Fold by name: "14 Forest (FDN)" and "6 Forest (M21)" are one decklist
    // entry asking for 20, not two entries. Filing them separately is what let
    // migration 19's reconcile trigger double-count a basic on sleeve.
    const key = deckImportKey(card.name);
    const existing = byName.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      continue;
    }

    byName.set(key, {
      line: row.line,
      cardId: card.scryfall_id,
      name: card.name,
      matched: `${card.name} · ${card.set_code.toUpperCase()} #${card.collector_number}`,
      setCode: card.set_code,
      imageUri: card.image_uri_small,
      quantity: row.quantity,
    });
  }

  const lines = [...byName.values()];
  return {
    lines,
    totalCards: lines.reduce((sum, line) => sum + line.quantity, 0),
    unmatched,
  };
}

/**
 * Against the cards the deck already lists (by name), how many import lines land
 * on an existing entry — quantity added on top — versus a fresh one.
 *
 * `existingNames` are the deck's current entry names; they are compared through
 * `deckImportKey`, so casing does not matter.
 */
export function splitAgainstDeck(
  lines: DeckImportLine[],
  existingNames: Iterable<string>,
): { newEntries: number; mergedEntries: number } {
  const have = new Set<string>();
  for (const name of existingNames) have.add(deckImportKey(name));

  let newEntries = 0;
  let mergedEntries = 0;

  for (const line of lines) {
    if (have.has(deckImportKey(line.name))) mergedEntries += 1;
    else newEntries += 1;
  }

  return { newEntries, mergedEntries };
}
