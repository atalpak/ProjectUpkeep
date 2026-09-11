/**
 * Reconciling a list you have not committed to.
 *
 * The deck page answers "how is this deck coming along?" — and to do that it
 * needs a deck: a physical container, with cards sleeved into it. See
 * src/lib/collection/deck-state.ts.
 *
 * This answers the question you ask *before* that, browsing a list on a Sunday:
 * "could I build this right now, and what would it cost me?" There is no deck,
 * so nothing is sleeved, and the three states mean something different:
 *
 *   ready      — enough free copies sitting in binders and boxes.
 *   elsewhere  — you own enough, but some are sleeved into other decks, so
 *                building this one means taking that one apart.
 *   missing    — you do not own enough copies at all.
 *
 * That middle state is the one the deck page cannot express and this screen
 * exists for. `deck-state.ts` folds "sleeved in another deck" into `missing`,
 * which is right there (a copy in another deck is not one you can sleeve into
 * this one without a decision) and wrong here: "you own it, go and get it" and
 * "you do not own it" lead to completely different next actions — one is a
 * shoebox, the other is a purchase or a trade.
 *
 * Counted per card rather than per printing, on the same `oracle_id` key
 * availability uses: a list asks for four Lightning Bolts, not for four of one
 * particular Lightning Bolt.
 */

import { cardKey, type Availability } from "@/lib/collection/availability";

export const LIST_CHECK_STATES = ["ready", "elsewhere", "missing"] as const;
export type ListCheckState = (typeof LIST_CHECK_STATES)[number];

export const LIST_CHECK_LABELS: Record<ListCheckState, string> = {
  ready: "Ready",
  elsewhere: "In another deck",
  missing: "Not owned",
};

/** The card fields this screen needs. A narrow slice of `Card` on purpose —
 *  the resolver hands back printings, and re-reading whole card rows to draw a
 *  list would be the same mistake the paginated collection query was written
 *  to undo. */
export type CheckCard = {
  scryfall_id: string;
  oracle_id: string | null;
  name: string;
  flavor_name: string | null;
  set_code: string;
  collector_number: string;
  type_line: string | null;
  mana_cost: string | null;
  cmc: number | null;
  rarity: string | null;
  colors: string[] | null;
  image_uri_small: string | null;
  /** Already on every card row — no extra read to show what a missing copy
   *  would cost. */
  price_usd: number | null;
};

export type CheckCounts = {
  /** How many the list asks for. */
  wanted: number;
  /** Copies free right now — anywhere that is not a deck. */
  free: number;
  /** Copies you own that are sleeved into some deck. */
  inDecks: number;
};

export type CheckedEntry = CheckCounts & {
  state: ListCheckState;
  /** Of `wanted`, how many free copies cover. */
  fromFree: number;
  /** …how many would mean unsleeving another deck. */
  fromDecks: number;
  /** …and how many you would have to acquire. */
  short: number;
};

/**
 * Where each copy of one entry would come from.
 *
 * Free copies are spent first, then copies sitting in decks, and whatever is
 * left over is the shortfall. That order is the cheapest-first one: grabbing a
 * card out of a binder costs nothing, taking one out of a built deck costs that
 * deck, and buying costs money.
 */
export function checkEntry(counts: CheckCounts): CheckedEntry {
  const fromFree = Math.min(counts.wanted, counts.free);
  const rest = counts.wanted - fromFree;
  const fromDecks = Math.min(rest, counts.inDecks);
  const short = rest - fromDecks;

  const state: ListCheckState = short > 0 ? "missing" : fromDecks > 0 ? "elsewhere" : "ready";

  return { ...counts, state, fromFree, fromDecks, short };
}

/**
 * The free portion of an entry, in words — "3 free" on its own, or "3 free
 * (Box 3)" once it is known which container. Multiple containers are listed
 * in full: at check-list scale a card rarely sits in more than two or three,
 * and naming them beats a vague "+2 more" for something you are about to go
 * and get.
 */
export function describeSpare(fromFree: number, spareIn: readonly string[]): string {
  if (fromFree === 0) return "";
  if (spareIn.length === 0) return `${fromFree} free`;
  return `${fromFree} free (${spareIn.join(", ")})`;
}

/**
 * The sleeved-elsewhere portion of an entry, in words.
 *
 * "N in another deck" used to leave "another" doing all the work — naming the
 * deck is what turns this into something actionable ("go unsleeve it from
 * Mono-Red Aggro"). Two or more decks collapse to a count rather than a list:
 * unlike a container, a deck you would raid is a bigger decision, and which
 * one is worth a second look before it is worth a sentence.
 */
export function describeElsewhere(fromDecks: number, deckNames: readonly string[]): string {
  if (fromDecks === 0) return "";
  if (deckNames.length === 0) return `${fromDecks} in another deck`;
  if (deckNames.length === 1) return `${fromDecks} in ${deckNames[0]}`;
  return `${fromDecks} in ${deckNames.length} other decks`;
}

/** Counts for one entry, from the availability map. */
export function countsFrom(wanted: number, availability: Availability): CheckedEntry {
  return checkEntry({
    wanted,
    free: availability.available,
    inDecks: availability.inDecks,
  });
}

// ---------------------------------------------------------------------------
// Folding a resolved list into entries
// ---------------------------------------------------------------------------

/** One matched line of the pasted list, before duplicates are folded together. */
export type ListLine = {
  /** 1-based line in the original input, for reporting. */
  line: number;
  quantity: number;
  card: CheckCard;
};

export type ListEntry = {
  /** `cardKey` of the card — oracle id, or a name fallback. */
  key: string;
  /** Earliest input line this card appeared on, so entries keep list order. */
  line: number;
  wanted: number;
  /** The first printing seen for this card, for the art and the set symbol. */
  card: CheckCard;
  /** Distinct printings folded in here, when the list named more than one. */
  printings: number;
};

/**
 * Sums a resolved list into one entry per *card*.
 *
 * The deck importer folds by printing, because a decklist may legitimately want
 * fourteen of one Forest art and six of another and both are real rows in the
 * deck. A availability check must not: availability is counted per card, so
 * leaving those as two entries of 14 and 6 would compare each against the same
 * "20 free" and cheerfully report both as ready — the collection counted twice.
 *
 * Entries keep first-seen order rather than being sorted here; the display
 * groups and sorts them, and a caller that wants the raw list should get it in
 * the order it was pasted.
 */
export function foldByCard(lines: ListLine[]): ListEntry[] {
  const byCard = new Map<string, ListEntry>();
  // Printings are counted through a set rather than incremented, so a list that
  // names the same printing twice reports one printing and not two.
  const printings = new Map<string, Set<string>>();

  for (const line of lines) {
    const key = cardKey(line.card);
    if (key === null) continue;

    const seen = printings.get(key);
    if (seen) {
      seen.add(line.card.scryfall_id);
      const entry = byCard.get(key)!;
      entry.wanted += line.quantity;
      entry.printings = seen.size;
      continue;
    }

    printings.set(key, new Set([line.card.scryfall_id]));
    byCard.set(key, {
      key,
      line: line.line,
      wanted: line.quantity,
      card: line.card,
      printings: 1,
    });
  }

  return [...byCard.values()];
}

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

export type ListCheckSummary = {
  /** Distinct cards on the list. */
  entries: number;
  /** Cards the list asks for, counting a playset of four as four. */
  wanted: number;
  /** Of those, how many are covered by free copies. */
  free: number;
  /** …how many would come out of another deck. */
  inDecks: number;
  /** …and how many you do not own. */
  missing: number;
  readyEntries: number;
  elsewhereEntries: number;
  missingEntries: number;
  /** Every copy covered without touching another deck. */
  buildable: boolean;
};

export function summarize(entries: CheckedEntry[]): ListCheckSummary {
  const sum = (pick: (e: CheckedEntry) => number) =>
    entries.reduce((total, entry) => total + pick(entry), 0);

  const count = (state: ListCheckState) => entries.filter((e) => e.state === state).length;

  return {
    entries: entries.length,
    wanted: sum((e) => e.wanted),
    free: sum((e) => e.fromFree),
    inDecks: sum((e) => e.fromDecks),
    missing: sum((e) => e.short),
    readyEntries: count("ready"),
    elsewhereEntries: count("elsewhere"),
    missingEntries: count("missing"),
    // An empty list is not "buildable" — there is nothing to build. Guarding
    // here keeps the banner from congratulating you on a blank page.
    buildable: entries.length > 0 && entries.every((e) => e.state === "ready"),
  };
}
