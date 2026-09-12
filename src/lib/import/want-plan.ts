/**
 * Folding resolved import rows into wish-list entries.
 *
 * A want_list row has even less shape than a decklist entry (src/lib/import/
 * deck-plan.ts): no condition, finish or language, and — unlike a deck, which
 * can list the same card's two different printings as two rows — the table's
 * own uniqueness is one row per (user, printing), same as a manual add. So
 * this sums duplicate lines *by printing* exactly the way deck-plan.ts does,
 * and the server action decides new-versus-already-wanted against the
 * signed-in user's existing rows, not against a deck's.
 *
 * Pure on purpose: the database round trips are the server action's job, this
 * is testable against fabricated rows.
 */

import type { ResolvedRow } from "@/lib/import/resolve";
import { cardDisplayName } from "@/lib/types";

export type WantImportLine = {
  /** First input line this printing appeared on, for display. */
  line: number;
  /** cards.scryfall_id — the printing this line resolved to. */
  cardId: string;
  name: string;
  /** "Name · SET #123" for this printing. */
  matched: string;
  setCode: string | null;
  imageUri: string | null;
  /** Summed across every line that resolved to this same printing. */
  quantity: number;
};

export type WantImportPlan = {
  /** One per distinct printing, in first-seen order. */
  lines: WantImportLine[];
  /** Sum of every line's quantity. */
  totalCards: number;
  /** Rows that matched no card, echoed back so they can be fixed. */
  unmatched: Array<{ line: number; raw: string; reason: string }>;
};

export function planWantImport(resolved: ResolvedRow[]): WantImportPlan {
  const byPrinting = new Map<string, WantImportLine>();
  const unmatched: WantImportPlan["unmatched"] = [];

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
      matched: `${cardDisplayName(card)} · ${card.set_code.toUpperCase()} #${card.collector_number}`,
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
 * Against the printings already on the wish list, how many import lines land
 * on an existing want versus a fresh one.
 */
export function splitAgainstWantList(
  lines: WantImportLine[],
  existingCardIds: Iterable<string>,
): { newEntries: number; alreadyWanted: number } {
  const have = new Set(existingCardIds);
  let newEntries = 0;
  let alreadyWanted = 0;

  for (const line of lines) {
    if (have.has(line.cardId)) alreadyWanted += 1;
    else newEntries += 1;
  }

  return { newEntries, alreadyWanted };
}
