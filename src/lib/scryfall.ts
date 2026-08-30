/**
 * Scryfall bulk-data types and the mapping into our `cards` table.
 *
 * Kept separate from the sync script so the mapping can be unit-tested without
 * a network or a database (see scripts/sync-scryfall.test.ts).
 */

export type ScryfallBulkEntry = {
  type: string;
  updated_at: string;
  download_uri: string;
  size?: number;
  content_encoding?: string;
};

type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name?: string;
  collector_number: string;
  rarity?: string;
  type_line?: string;
  released_at?: string;
  lang?: string;
  digital?: boolean;
  finishes?: string[];
  scryfall_uri?: string;
  image_uris?: ScryfallImageUris;
  /** Present on double-faced/split cards, which carry images per face. */
  card_faces?: Array<{
    oracle_id?: string;
    image_uris?: ScryfallImageUris;
  }>;
};

/** A row shaped for `insert into public.cards`. */
export type CardRow = {
  scryfall_id: string;
  oracle_id: string | null;
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string | null;
  type_line: string | null;
  released_at: string | null;
  image_uri: string | null;
  image_uri_small: string | null;
  scryfall_uri: string | null;
  available_finishes: string[];
  lang: string;
  digital: boolean;
  last_synced_at: string;
};

/**
 * Our `finish` CHECK constraint is a closed vocabulary. Scryfall has been known
 * to introduce new finish names (etched and glossy both arrived after the fact),
 * so anything unrecognised is dropped rather than written — an unknown value
 * here would only surface later as a constraint violation on a user's insert.
 */
const KNOWN_FINISHES = new Set(["nonfoil", "foil", "etched", "glossy"]);

/**
 * Maps one bulk-export card to a `cards` row.
 *
 * Returns null for records we cannot store meaningfully, rather than writing a
 * half-row: the sync counts these and reports them at the end.
 */
export function toCardRow(card: ScryfallCard, syncedAt: string): CardRow | null {
  if (!card.id || !card.name || !card.set || !card.collector_number) {
    return null;
  }

  // Double-faced cards have no top-level image_uris; the faces carry them.
  // Use the front face, which is what a collection list wants to show.
  const images = card.image_uris ?? card.card_faces?.[0]?.image_uris;

  // `reversible_card` layouts omit the top-level oracle_id and put it on each
  // face instead.
  const oracleId = card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null;

  const finishes = (card.finishes ?? []).filter((f) => KNOWN_FINISHES.has(f));

  return {
    scryfall_id: card.id,
    oracle_id: oracleId,
    name: card.name,
    set_code: card.set,
    set_name: card.set_name ?? null,
    collector_number: card.collector_number,
    rarity: card.rarity ?? null,
    type_line: card.type_line ?? null,
    released_at: card.released_at ?? null,
    image_uri: images?.normal ?? images?.large ?? images?.small ?? null,
    image_uri_small: images?.small ?? images?.normal ?? null,
    scryfall_uri: card.scryfall_uri ?? null,
    // Fall back to nonfoil rather than an empty array: a printing with no
    // finishes at all would leave the add-card form with nothing to select.
    available_finishes: finishes.length > 0 ? finishes : ["nonfoil"],
    lang: card.lang ?? "en",
    digital: card.digital ?? false,
    last_synced_at: syncedAt,
  };
}

export const SCRYFALL_BULK_INDEX_URL = "https://api.scryfall.com/bulk-data";

/**
 * Scryfall's API guidelines ask for a descriptive User-Agent and an Accept
 * header. They are a free service run on donations; being identifiable is the
 * least we can do, and they rate-limit anonymous scrapers harder.
 */
export function scryfallHeaders(contact: string): Record<string, string> {
  return {
    "User-Agent": contact,
    Accept: "application/json",
  };
}
