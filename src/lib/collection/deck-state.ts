/**
 * The three states a decklist entry can be in.
 *
 * This is the question the deck page exists to answer, so it lives in one
 * tested place rather than being recomputed in JSX:
 *
 *   sleeved   — enough copies are physically in this deck.
 *   available — not sleeved, but you own spare copies elsewhere and could pull
 *               them in right now.
 *   missing   — you do not own enough spare copies to finish the entry.
 *
 * "Enough" is per entry: a list asking for four Bolts with three sleeved is not
 * done, and what matters next is whether the fourth is in a binder or not owned
 * at all. Partly-sleeved entries therefore report the state of the *remainder*,
 * because that is the thing you would act on.
 *
 * Copies are counted across every printing of a card, keyed on Scryfall's
 * oracle id — a decklist asks for Lightning Bolt, not for one particular
 * Lightning Bolt.
 */

import { ZERO_AVAILABILITY, type Availability } from "@/lib/collection/availability";

export const DECK_CARD_STATES = ["sleeved", "available", "missing"] as const;
export type DeckCardState = (typeof DECK_CARD_STATES)[number];

export const DECK_STATE_LABELS: Record<DeckCardState, string> = {
  sleeved: "Sleeved",
  available: "Available",
  missing: "Not available",
};

export type EntryCounts = {
  /** How many the list asks for. */
  wanted: number;
  /** How many are physically in this deck. */
  sleeved: number;
  /** Spare copies elsewhere in the collection, not in any deck. */
  available: number;
};

export type EntryState = EntryCounts & {
  state: DeckCardState;
  /** Still to sleeve. Zero when the entry is complete. */
  outstanding: number;
  /** How many of the outstanding copies could be sleeved right now. */
  sleevable: number;
};

export function entryState(counts: EntryCounts): EntryState {
  const outstanding = Math.max(0, counts.wanted - counts.sleeved);
  const sleevable = Math.min(outstanding, counts.available);

  const state: DeckCardState =
    outstanding === 0 ? "sleeved" : counts.available > 0 ? "available" : "missing";

  return { ...counts, state, outstanding, sleevable };
}

/**
 * Counts for one entry, from the availability map and this deck's contents.
 *
 * `availability.available` already excludes anything sitting in a deck — any
 * deck, including this one — so it is exactly "copies you could pull in", with
 * no need to subtract what is already sleeved here.
 */
export function countsFor(
  wanted: number,
  sleevedInThisDeck: number,
  availability: Availability,
): EntryState {
  return entryState({
    wanted,
    sleeved: sleevedInThisDeck,
    available: availability.available,
  });
}

/** How a deck is doing overall, for the header. */
export type DeckProgress = {
  entries: number;
  wanted: number;
  sleeved: number;
  /** Entries that are neither complete nor obtainable right now. */
  missingEntries: number;
};

export function deckProgress(states: EntryState[]): DeckProgress {
  return {
    entries: states.length,
    wanted: states.reduce((sum, s) => sum + s.wanted, 0),
    // Capped per entry: five sleeved against a list asking for four is a
    // counting mistake somewhere, and it must not report 125% complete.
    sleeved: states.reduce((sum, s) => sum + Math.min(s.sleeved, s.wanted), 0),
    missingEntries: states.filter((s) => s.state === "missing").length,
  };
}

/**
 * The least a decklist row needs to be placed into a state, across every deck
 * rather than just one — `deckId` is what separates "sleeved in this deck"
 * from "sleeved in a different one".
 */
export type DeckEntryRow = {
  deckId: string;
  /** `cardKey`'s output (availability.ts) — null for a row with no card to key on. */
  key: string | null;
  wanted: number;
};

/**
 * How many decklist entries, across every deck the user owns, are sitting in
 * the `available` state: not sleeved, but spare copies exist somewhere else in
 * the collection right now.
 *
 * Pure, so it can be tested without a database — see getCrossDeckAvailableCount
 * in queries.ts for the query that gathers the three ingredients this takes.
 * They are the same three every deck's own page already computes (the
 * decklist, what is physically sleeved per deck, and collection-wide
 * availability), so this aggregate can never disagree with what a deck page
 * shows for the same entry.
 *
 * `availability.get(key).available` is a *global* spare count for that card —
 * it has no notion of how many different decks are simultaneously short it.
 * Checking each entry against that number independently double-counts a
 * scarce shared spare: two decks each missing one Sol Ring, with exactly one
 * spare Sol Ring in the binder, would both read as "available" even though
 * pulling the spare into one deck leaves the other still short. So a card's
 * spare pool has to be allocated once across every entry asking for it, not
 * re-read by each entry as if it had the whole pool to itself: entries that
 * are not yet fully sleeved are grouped by card key across every deck first,
 * and only then is each key's `available` count spent against however many
 * entries are competing for it, capped at `min(available, shortEntries)`.
 */
export function countAvailableAcrossDecks(
  rows: readonly DeckEntryRow[],
  sleevedByDeck: ReadonlyMap<string, ReadonlyMap<string, number>>,
  availability: ReadonlyMap<string, Availability>,
): number {
  // How many *distinct* deck entries, per card key, are still short — a fully
  // sleeved entry is done and does not compete for the key's spare pool.
  const shortEntriesByKey = new Map<string, number>();
  for (const row of rows) {
    if (row.key === null) continue;
    const sleeved = sleevedByDeck.get(row.deckId)?.get(row.key) ?? 0;
    const outstanding = Math.max(0, row.wanted - sleeved);
    if (outstanding === 0) continue;
    shortEntriesByKey.set(row.key, (shortEntriesByKey.get(row.key) ?? 0) + 1);
  }

  let count = 0;
  for (const [key, shortEntries] of shortEntriesByKey) {
    const available = (availability.get(key) ?? ZERO_AVAILABILITY).available;
    // Each entry is a yes/no — "is there a spare for this one" — exactly what
    // entryState() decides for a single entry; the cap is what stops the same
    // spare from saying yes to more entries than actually exist to give it to.
    count += Math.min(available, shortEntries);
  }
  return count;
}
