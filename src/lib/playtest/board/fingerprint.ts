/**
 * The deck-source fingerprint: a stable digest of what a game was started
 * from, so a saved game can tell whether the deck has changed since.
 *
 * This module builds the STANDARD TEXT only. The hash itself is computed on
 * the server (`page.tsx`, node crypto SHA-256) and stored on the game as
 * `source.fingerprint`; a save copies the snapshot's own fingerprint and never
 * recomputes it at save time, because "the deck when this game started" is the
 * question, not "the deck right now". Keeping the hash out of here keeps this
 * folder free of any runtime or platform API.
 *
 * The text is canonical: a version tag, then one `cardId:quantity` line per
 * distinct printing sorted by id (so list order and duplicate rows do not
 * matter), then the commander ids sorted. Changing this format changes every
 * fingerprint, so bump the tag rather than editing it in place.
 */

export const FINGERPRINT_VERSION = "upkeep-playtest-fp-v1";

export function fingerprintText(
  entries: ReadonlyArray<{ cardId: string; quantity: number }>,
  commanderCardIds: readonly string[],
): string {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.cardId, (totals.get(entry.cardId) ?? 0) + entry.quantity);
  const lines = [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cardId, quantity]) => `${cardId}:${quantity}`);
  const commanders = [...commanderCardIds].sort();
  return [FINGERPRINT_VERSION, ...lines, `commanders:${commanders.join(",")}`].join("\n");
}

export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
