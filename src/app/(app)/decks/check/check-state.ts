/**
 * State for the list check.
 *
 * Kept out of actions.ts because that file carries "use server" and may only
 * export async functions — same split as decks/import/deck-import-state.ts.
 */

import type { CheckCard, CheckedEntry, ListCheckSummary } from "@/lib/collection/list-check";

/** One card on the list, with where its copies would come from. */
export type CheckRow = CheckedEntry & {
  /** `cardKey` of the card — unique per row, so it doubles as the React key. */
  key: string;
  /** Earliest input line, so rows can be traced back to the pasted text. */
  line: number;
  card: CheckCard;
  /** How many distinct printings of this card the list named. */
  printings: number;
};

export type ListCheckResult = {
  /** How the input was read, so a mis-detection is visible rather than silent. */
  format: "csv" | "text" | "empty";
  summary: ListCheckSummary;
  rows: CheckRow[];
  /** Lines that read fine but matched no card. */
  skipped: Array<{ line: number; raw: string; reason: string }>;
  /** Lines the parser could not read at all. */
  problems: Array<{ line: number; raw: string; reason: string }>;
};

export type ListCheckState = {
  error: string | null;
  notice: string | null;
  result: ListCheckResult | null;
};

export const EMPTY_LIST_CHECK_STATE: ListCheckState = {
  error: null,
  notice: null,
  result: null,
};

/**
 * How many cards a single check will look at.
 *
 * A decklist is at most a few hundred cards; this is generous enough for a
 * cube list and small enough that the availability query stays one round trip.
 * Pasting a whole collection export here is a different feature (the importer),
 * and saying so beats silently checking the first slice of it.
 */
export const MAX_CHECK_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Saving the list as a real deck
// ---------------------------------------------------------------------------

export type SaveDeckState = {
  error: string | null;
  /** Set on success, so the form can send you to the new deck. */
  deckId: string | null;
  deckName: string | null;
};

export const EMPTY_SAVE_DECK_STATE: SaveDeckState = {
  error: null,
  deckId: null,
  deckName: null,
};
