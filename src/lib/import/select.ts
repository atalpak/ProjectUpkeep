/**
 * Choosing which printing an imported line means.
 *
 * Split out from resolve.ts, which owns the database round trips, so this — the
 * part that decides what a person actually gets — is pure and can be tested
 * against fabricated printings. "4 Lightning Bolt" is 76 different cards, and
 * which one we file is a policy question, not a query one.
 */

import type { ParsedRow } from "@/lib/import/parse";

export type MatchedCard = {
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  image_uri_small: string | null;
  available_finishes: string[];
  released_at: string | null;
  digital: boolean;
  /** Scryfall's set classification. Null on rows synced before migration 7. */
  set_type?: string | null;
};

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Set classes that represent a card as it was actually printed for play, best
 * first.
 *
 * Everything absent from this list — promos, The List, Secret Lair, box
 * toppers, memorabilia — sorts below all of them. Without this, "newest wins"
 * files a plain `4 Lightning Bolt` as a The List promo, because the most
 * recent printing of a staple is almost always a special product rather than
 * the ordinary one someone means.
 */
const SET_TYPE_RANK: Record<string, number> = {
  core: 0,
  expansion: 0,
  masters: 1,
  draft_innovation: 1,
  commander: 2,
  starter: 2,
  duel_deck: 3,
  from_the_vault: 3,
  premium_deck: 3,
  box: 3,
  spellbook: 3,
  arsenal: 3,
};

/** Unknown and unlisted set types sort last, but still sort. */
const OTHER_SET_RANK = 9;

const setRank = (card: MatchedCard): number =>
  card.set_type ? (SET_TYPE_RANK[card.set_type] ?? OTHER_SET_RANK) : OTHER_SET_RANK;

/**
 * Orders printings by how likely each is to be the one someone meant.
 *
 * Paper before digital, then ordinary products before promos, then newest.
 * Before migration 7 every row has a null `set_type`, which ranks them all
 * equally and leaves the old newest-first behaviour intact.
 */
export function preferred(a: MatchedCard, b: MatchedCard): number {
  if (a.digital !== b.digital) return a.digital ? 1 : -1;

  const ar = setRank(a);
  const br = setRank(b);
  if (ar !== br) return ar - br;

  const at = a.released_at ?? "";
  const bt = b.released_at ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.collector_number.localeCompare(b.collector_number, undefined, { numeric: true });
}

/**
 * Narrows a name's printings using whatever the row said about the set.
 *
 * `setHint` is checked against both the code and the name because the column it
 * came from — usually "Edition" — means the code at Moxfield and the name at
 * Deckbox, and the file does not say which.
 */
export function matchesSet(card: MatchedCard, row: ParsedRow): boolean {
  if (row.setCode) return lower(card.set_code) === lower(row.setCode);
  if (row.setName) return lower(card.set_name) === lower(row.setName);
  if (row.setHint) {
    const hint = lower(row.setHint);
    return lower(card.set_code) === hint || lower(card.set_name) === hint;
  }
  return true;
}

export function statedSet(row: ParsedRow): string | null {
  return row.setCode ?? row.setName ?? row.setHint ?? null;
}

/**
 * Picks the printing for one row out of every printing of its name.
 *
 * Returns the chosen card plus a warning when we had to ignore something the
 * row asked for, so the preview can show it rather than quietly doing the wrong
 * thing.
 */
export function choosePrinting(
  row: ParsedRow,
  candidates: MatchedCard[],
): { card: MatchedCard; warning: string | null } | null {
  if (candidates.length === 0) return null;

  const inSet = candidates.filter((c) => matchesSet(c, row));
  const set = statedSet(row);

  // The set was named but we have no printing from it.
  if (inSet.length === 0) {
    const fallback = [...candidates].sort(preferred)[0];
    return {
      card: fallback,
      warning: `No printing found in "${set}" — filed the ${fallback.set_code.toUpperCase()} printing instead.`,
    };
  }

  if (row.collectorNumber) {
    const wanted = lower(row.collectorNumber);
    const exact = inSet.find((c) => lower(c.collector_number) === wanted);
    if (exact) return { card: exact, warning: null };

    const fallback = [...inSet].sort(preferred)[0];
    return {
      card: fallback,
      warning: `No #${row.collectorNumber} in ${fallback.set_code.toUpperCase()} — filed #${fallback.collector_number}.`,
    };
  }

  const chosen = [...inSet].sort(preferred)[0];

  // No set was stated and the name has several printings: say which we picked,
  // because "4 Lightning Bolt" is 76 different cards and the choice matters to
  // anyone tracking specific printings.
  const warning =
    set === null && candidates.length > 1
      ? `${candidates.length} printings — filed the ${chosen.set_code.toUpperCase()} one.`
      : null;

  return { card: chosen, warning };
}
