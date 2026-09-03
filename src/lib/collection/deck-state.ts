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

import type { Availability } from "@/lib/collection/availability";

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
