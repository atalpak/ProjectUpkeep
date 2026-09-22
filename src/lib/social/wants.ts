/**
 * Matching a want list against trade binders.
 *
 * Given a set of "cards I want" and a set of "cards someone has open for
 * trade", work out who can fill what. Used both ways round: my wants against my
 * friends' binders (the wants page), and a friend's wants against my binder
 * (their profile).
 *
 * Pure and key-agnostic — callers pass an oracle-id-based key string so the
 * "any printing counts" rule lives with `cardKey`, not here.
 *
 * `matchTradablesByTerm` below answers a different question with the same
 * data: not "who can fill this exact want" (a key already known in advance)
 * but "who has anything matching what was just typed" — the free-text half
 * that powers /find's "Among your friends" section and the header search's
 * compact echo of it. It matches on name, the same every-word-anywhere rule
 * `nameMatches` applies to a person's own collection, rather than on `key`.
 *
 * `matchFriendCardStock` further down answers a third question: the card
 * popup already knows exactly which card and which printing it is looking
 * at, and wants to say which friends have it open for trade — and whether
 * their copy is that printing or a different one of the same card.
 */

import type { FlippableCard } from "@/lib/cards/faces";
import { nameMatches, MIN_TERM } from "@/lib/collection/locate";
import { cardDisplayName, languageLabel } from "@/lib/types";

/** One line of a want list, ready to match. */
export type WantRow = {
  /** The want_list row id. */
  id: string;
  /** oracle-id key, shared by every printing of the card. */
  key: string;
  /** The real game name — what the collection's own search matches on. Use
   *  this to build a `/collection?q=` link, not `displayName`. */
  name: string;
  /** What to show: the printed name when the printing has one. */
  displayName: string;
  /** Representative printing, for the card panel. */
  cardId: string | null;
  /** Small crop — right for a list row's thumbnail, too soft stretched any
   *  bigger. */
  image: string | null;
  /** Full-resolution crop, for the gallery view's larger tile. Optional for
   *  the same reason `price` is: a couple of callers build a throwaway
   *  `WantRow` purely to feed `matchSuppliersFor`, which never renders an
   *  image at gallery size. */
  imageLarge?: string | null;
  /** The printing's faces, present only when it has two printed sides, so the
   *  gallery tile can offer a flip. Absent or null: nothing to flip. */
  flip?: FlippableCard | null;
  /**
   * The representative printing's non-foil price — a want names a card, not
   * a finish, so this is always the plain listing, the same choice the add
   * flow's draft rows make. Optional because a couple of callers (deck-page
   * matching, /decks/check) build a throwaway `WantRow` purely to feed
   * `matchSuppliersFor`, which never reads price — they simply omit it.
   * `null` (as opposed to omitted) means Scryfall has no recent sale.
   */
  price?: { value: number | null; approximate: boolean } | null;
  quantity: number;
  note: string | null;
  /**
   * The deck this want is tagged to (migration 17), own list only. A friend's
   * want row never carries this — see src/lib/social/queries.ts, which does
   * not select deck_id when building a friend-facing payload. Undefined for
   * anything that predates the tag; null once it has been looked at and found
   * untagged.
   */
  deckId?: string | null;
  deckName?: string | null;
};

/** One stack sitting in someone's trade binder. */
export type TradableRow = {
  ownerId: string;
  key: string;
  quantity: number;
  locationName: string | null;
  /**
   * The exact printing this stack is (a `cards.scryfall_id`), when the caller
   * bothered to load it. Optional because most callers here only ever care
   * about the oracle-level `key` — "any printing counts" is the whole point
   * of `matchWants`. `matchFriendCardStock` below is the one place printing
   * identity matters, because the card popup is looking at one specific
   * printing and wants to say whether a friend's copy is that one or not.
   */
  cardId?: string | null;
  /** The copy's language (`card_instances.language`), for a supplier line
   *  that should say when what someone has isn't English. */
  language?: string;
};

/** What one person can supply toward a want. */
export type WantSupplier = {
  ownerId: string;
  /** Copies of the wanted card this person has open for trade. */
  available: number;
  /** The containers those copies are in, deduped. */
  locations: string[];
  /**
   * The non-English languages among this supplier's copies, deduped — empty
   * when everything they have is English, which is the common case and not
   * worth naming. Wish-list matching stays language-agnostic (any printing in
   * any language still fills a want), this only carries what to *show*.
   */
  languages: string[];
};

/**
 * "2 in Trade Binder B" — the count-and-container half of a supplier line.
 *
 * `/decks/check` said this first ("Dave has 4 in Trade Binder B", see
 * check-state.ts), and every other place that names who can fill a want — the
 * wants page, a deck's own wish list, a friend's profile showing what you
 * could offer them back — is answering the same question with the same two
 * numbers, so the phrase lives here once rather than being rebuilt at each
 * call site. Callers supply their own subject and verb ("Dave has" / "you
 * have"); this is only ever what comes after it.
 *
 * `languages` is optional and, when given, only adds a parenthetical when it
 * is not empty — the same "only show when it deviates" rule `FoilMark` uses
 * for finish, so an all-English supplier reads exactly as it did before this
 * existed.
 */
export function describeSupplier(
  available: number,
  locations: readonly string[],
  languages: readonly string[] = [],
): string {
  const base = locations.length === 0 ? `${available}` : `${available} in ${locations.join(", ")}`;
  if (languages.length === 0) return base;
  return `${base} (${languages.map(languageLabel).join(", ")})`;
}

/**
 * For each want row, who can supply it, best first.
 *
 * Keyed by want-row id so the caller can look matches up as it renders the
 * list. A want with no suppliers simply is not in the map.
 */
export function matchWants(
  wants: readonly WantRow[],
  tradables: readonly TradableRow[],
): Map<string, WantSupplier[]> {
  // key -> ownerId -> { available, locations }
  const byKey = new Map<string, Map<string, WantSupplier>>();

  for (const row of tradables) {
    if (row.quantity <= 0) continue;

    let owners = byKey.get(row.key);
    if (!owners) {
      owners = new Map();
      byKey.set(row.key, owners);
    }

    const current = owners.get(row.ownerId);
    if (current) {
      current.available += row.quantity;
      if (row.locationName && !current.locations.includes(row.locationName)) {
        current.locations.push(row.locationName);
      }
      if (row.language && row.language !== "en" && !current.languages.includes(row.language)) {
        current.languages.push(row.language);
      }
    } else {
      owners.set(row.ownerId, {
        ownerId: row.ownerId,
        available: row.quantity,
        locations: row.locationName ? [row.locationName] : [],
        languages: row.language && row.language !== "en" ? [row.language] : [],
      });
    }
  }

  const result = new Map<string, WantSupplier[]>();

  for (const want of wants) {
    const owners = byKey.get(want.key);
    if (!owners || owners.size === 0) continue;

    const suppliers = [...owners.values()].sort(
      (a, b) => b.available - a.available || a.ownerId.localeCompare(b.ownerId),
    );
    result.set(want.id, suppliers);
  }

  return result;
}

/** How many of a want list's entries have at least one supplier. */
export function countMatchedWants(
  wants: readonly WantRow[],
  tradables: readonly TradableRow[],
): number {
  return matchWants(wants, tradables).size;
}

// ---------------------------------------------------------------------------
// Free-text search across trade binders (/find's "Among your friends")
// ---------------------------------------------------------------------------

/**
 * A friend's tradable copy, carrying enough of the card to search by name.
 *
 * `matchWants` above only ever needs `key` — the want it is matching against
 * already names an exact card. A typed search term does not, so this extends
 * the plain row with what `nameMatches` needs.
 */
export type NamedTradableRow = TradableRow & {
  name: string;
  /** The printed name, when the printing has one — see `cardDisplayName`. */
  flavorName: string | null;
};

/** One card matching a search term, and who has it open for trade. */
export type FriendCardMatch = {
  /** oracle-id key, or the name fallback — the same convention `cardKey` uses. */
  key: string;
  /** The real game name — what /collection?q= and /find search on. */
  name: string;
  /** What to show: the printed name when the printing has one. */
  displayName: string;
  /** A sample printing's id, for the card popup — any one of the matched rows. */
  cardId: string | null;
  /** Best supplier first, same ordering `matchWants` uses. */
  suppliers: WantSupplier[];
};

/**
 * Free-text search across friends' trade binders.
 *
 * Groups by card the way `locateCards` groups a person's own collection —
 * every word in the term has to appear in the name (or the printed flavor
 * name), matched with the exact same `nameMatches` rule, so searching your own
 * cards and searching your circle's feels like the same search.
 */
export function matchTradablesByTerm(
  term: string,
  tradables: readonly NamedTradableRow[],
  limit = 20,
): FriendCardMatch[] {
  if (term.trim().length < MIN_TERM) return [];

  const byKey = new Map<
    string,
    { name: string; displayName: string; cardId: string | null; owners: Map<string, WantSupplier> }
  >();

  for (const row of tradables) {
    if (row.quantity <= 0 || !row.key) continue;

    const matches =
      nameMatches(row.name, term) || (row.flavorName ? nameMatches(row.flavorName, term) : false);
    if (!matches) continue;

    let entry = byKey.get(row.key);
    if (!entry) {
      entry = {
        name: row.name,
        displayName: cardDisplayName({ name: row.name, flavor_name: row.flavorName }),
        cardId: row.cardId ?? null,
        owners: new Map(),
      };
      byKey.set(row.key, entry);
    }

    const current = entry.owners.get(row.ownerId);
    if (current) {
      current.available += row.quantity;
      if (row.locationName && !current.locations.includes(row.locationName)) {
        current.locations.push(row.locationName);
      }
      if (row.language && row.language !== "en" && !current.languages.includes(row.language)) {
        current.languages.push(row.language);
      }
    } else {
      entry.owners.set(row.ownerId, {
        ownerId: row.ownerId,
        available: row.quantity,
        locations: row.locationName ? [row.locationName] : [],
        languages: row.language && row.language !== "en" ? [row.language] : [],
      });
    }
  }

  const result: FriendCardMatch[] = [...byKey.entries()].map(([key, e]) => ({
    key,
    name: e.name,
    displayName: e.displayName,
    cardId: e.cardId,
    suppliers: [...e.owners.values()].sort(
      (a, b) => b.available - a.available || a.ownerId.localeCompare(b.ownerId),
    ),
  }));

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result.slice(0, limit);
}

/**
 * The first `max` suppliers for one card, plus how many more there are.
 *
 * The header search dropdown has room for two or three lines before a search
 * result stops looking like a search result; the /find page has room for all
 * of them. Rather than teach the matcher two different lengths, it always
 * returns everyone and the caller that is short on space trims the ends.
 */
export function capSuppliers(
  suppliers: readonly WantSupplier[],
  max: number,
): { shown: WantSupplier[]; more: number } {
  return { shown: suppliers.slice(0, max), more: Math.max(0, suppliers.length - max) };
}

// ---------------------------------------------------------------------------
// One card, by printing (the card popup's "Friends have this")
// ---------------------------------------------------------------------------

/** One friend's stock of a card, and whether it's the printing being looked at. */
export type FriendPrintingSupplier = {
  ownerId: string;
  /** Copies open for trade — of the exact printing if any exist, else of some
   *  other printing of the same card. Never a sum of both; see below. */
  count: number;
  /** True when at least one of those copies is the exact printing asked about. */
  samePrinting: boolean;
};

/**
 * Who has a specific card open for trade, and whether it's this printing or a
 * different one — the card popup's "Friends have this" line.
 *
 * A narrower question than `matchWants`: that function is happy to know a want
 * is filled by any printing. The popup is looking at one specific printing and
 * wants to say so, which is why `tradables` here needs `cardId` populated.
 * When a friend has both the exact printing and another one, the exact
 * printing is the more useful fact, so it wins outright rather than being
 * summed with the rest — a friend line never says "3 (this printing and
 * another)".
 */
export function matchFriendCardStock(
  cardId: string,
  key: string,
  tradables: readonly TradableRow[],
): FriendPrintingSupplier[] {
  const byOwner = new Map<string, { same: number; other: number }>();

  for (const row of tradables) {
    if (row.quantity <= 0 || row.key !== key) continue;

    const current = byOwner.get(row.ownerId) ?? { same: 0, other: 0 };
    if (row.cardId === cardId) current.same += row.quantity;
    else current.other += row.quantity;
    byOwner.set(row.ownerId, current);
  }

  return [...byOwner.entries()]
    .map(([ownerId, { same, other }]) => ({
      ownerId,
      count: same > 0 ? same : other,
      samePrinting: same > 0,
    }))
    .sort((a, b) => b.count - a.count || a.ownerId.localeCompare(b.ownerId));
}
