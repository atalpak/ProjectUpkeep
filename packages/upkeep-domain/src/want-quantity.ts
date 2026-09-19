/**
 * The bounds on a wanted quantity.
 *
 * `want_list.quantity` is CHECKed to 1..10000 (migration 15), so a client that
 * lets a stepper walk outside it gets a database error instead of a stopped
 * button. Going to zero is not "quantity 0": that is removal, a separate,
 * confirmed action.
 */
export const MIN_WANT_QUANTITY = 1;
export const MAX_WANT_QUANTITY = 10000;

/** Coerces to a whole number inside the allowed range; anything unreadable becomes the minimum. */
export function clampWantQuantity(n: number): number {
  if (!Number.isFinite(n)) return MIN_WANT_QUANTITY;
  return Math.min(MAX_WANT_QUANTITY, Math.max(MIN_WANT_QUANTITY, Math.floor(n)));
}
