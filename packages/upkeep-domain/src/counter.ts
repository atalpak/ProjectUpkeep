/**
 * Turning a trade you received into the starting point for a counter-offer.
 *
 * A counter is a brand-new proposal authored by the person who received the
 * first one — not an edit of someone else's row. So the builder opens with the
 * original mirrored into the countering user's frame:
 *
 *   - what they were being asked to give up  -> their "offering" side
 *   - what they were being offered           -> their "requesting" side
 *
 * The countering user is always the *recipient* of the trade being countered
 * (only the recipient sees a "Counter" action), so "give up" is the original's
 * `from_recipient` items and "offered" is its `from_proposer` items.
 *
 * Pure, and separate from the page, so the direction mapping — the one thing
 * here that is easy to get backwards — is tested directly.
 */

export type CounterSourceItem = {
  direction: "from_proposer" | "from_recipient" | string;
  quantity: number;
  instanceId: string | null | undefined;
};

/** Card-instance id -> quantity, the shape the trade builder seeds from. */
export type Selection = Record<string, number>;

export type CounterSeed = {
  /** Cards the countering user puts up — pre-selected on their side. */
  offering: Selection;
  /** Cards the countering user asks back for — pre-selected on the other side. */
  requesting: Selection;
};

/**
 * Builds the pre-selection for a counter-offer.
 *
 * `ownIds` and `otherIds` are the instance ids still genuinely offerable on
 * each side (i.e. sitting in a tradable container). An item whose card has since
 * moved out of a trade binder is dropped rather than seeded, so the builder
 * never submits an id the trade policies would reject.
 */
export function mirrorTradeForCounter(
  items: readonly CounterSourceItem[],
  ownIds: Iterable<string>,
  otherIds: Iterable<string>,
): CounterSeed {
  const mine = ownIds instanceof Set ? ownIds : new Set(ownIds);
  const theirs = otherIds instanceof Set ? otherIds : new Set(otherIds);

  const offering: Selection = {};
  const requesting: Selection = {};

  for (const item of items) {
    const id = item.instanceId;
    if (!id) continue;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;

    if (item.direction === "from_recipient" && mine.has(id)) {
      offering[id] = item.quantity;
    } else if (item.direction === "from_proposer" && theirs.has(id)) {
      requesting[id] = item.quantity;
    }
  }

  return { offering, requesting };
}

/** True when a counter would carry nothing across — not worth opening the builder pre-filled. */
export function counterSeedIsEmpty(seed: CounterSeed): boolean {
  return (
    Object.keys(seed.offering).length === 0 && Object.keys(seed.requesting).length === 0
  );
}
