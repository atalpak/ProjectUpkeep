/**
 * The several ways one card's name gets written down.
 *
 * A card with two halves — a split card, a transforming card, an adventure, or
 * one of the "prepared" cards from Secrets of Strixhaven — is stored by
 * Scryfall, and therefore by us, with both halves joined by a double slash:
 *
 *     Lorehold Archivist // Restore Relic
 *
 * Exporters do not agree. Depending on the tool, the same card is written with
 * a single slash ("Lorehold Archivist / Restore Relic"), with no spaces around
 * the slashes, or as the front face alone ("Lorehold Archivist"). A decklist
 * pasted from a deck site is very often the single-slash form, and matching it
 * literally finds nothing at all.
 *
 * So a name is not one string to look up, it is a small ordered set of
 * candidate spellings. Pure and separate from the resolver so the parsing rule
 * can be tested exhaustively without a database.
 */

/**
 * One or two slashes with any surrounding whitespace.
 *
 * String.split applies a regex repeatedly whether or not it carries the `g`
 * flag, so this splits every face, not just the first.
 */
const FACE_SEPARATOR = /\s*\/{1,2}\s*/;

/** The halves of a name, in printed order. A single-faced name yields one. */
export function faces(raw: string): string[] {
  return raw
    .trim()
    .split(FACE_SEPARATOR)
    .map((face) => face.trim())
    .filter(Boolean);
}

/** The front face — what most exporters use when they abbreviate. */
export function frontFace(raw: string): string {
  return faces(raw)[0] ?? raw.trim();
}

/**
 * Every spelling worth trying, best first.
 *
 *   1. Exactly what was written. Almost always right, and cheapest.
 *   2. The canonical " // " form, which is how the database stores it. This is
 *      what rescues the single-slash and no-space spellings.
 *   3. The front face alone, which the resolver's prefix pass turns back into
 *      the full name.
 *
 * Deduplicated and order-preserving, so a name already in canonical form costs
 * exactly one lookup.
 */
export function nameVariants(raw: string): string[] {
  const name = raw.trim();
  if (name === "") return [];
  if (!name.includes("/")) return [name];

  const parts = faces(name);
  if (parts.length === 0) return [name];

  return [...new Set([name, parts.join(" // "), parts[0]])];
}
