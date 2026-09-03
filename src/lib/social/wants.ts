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
 */

/** One line of a want list, ready to match. */
export type WantRow = {
  /** The want_list row id. */
  id: string;
  /** oracle-id key, shared by every printing of the card. */
  key: string;
  name: string;
  /** Representative printing, for the card panel. */
  cardId: string | null;
  image: string | null;
  quantity: number;
  note: string | null;
};

/** One stack sitting in someone's trade binder. */
export type TradableRow = {
  ownerId: string;
  key: string;
  quantity: number;
  locationName: string | null;
};

/** What one person can supply toward a want. */
export type WantSupplier = {
  ownerId: string;
  /** Copies of the wanted card this person has open for trade. */
  available: number;
  /** The containers those copies are in, deduped. */
  locations: string[];
};

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
    } else {
      owners.set(row.ownerId, {
        ownerId: row.ownerId,
        available: row.quantity,
        locations: row.locationName ? [row.locationName] : [],
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
