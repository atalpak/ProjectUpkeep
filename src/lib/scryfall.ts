/**
 * Scryfall bulk-data types and the mapping into our `cards` table.
 *
 * Kept separate from the sync script so the mapping can be unit-tested without
 * a network or a database (see scripts/sync-scryfall.test.ts).
 */

export type ScryfallBulkEntry = {
  type: string;
  updated_at: string;
  // Scryfall serves the bulk exports as gzipped JSON Lines. The uncompressed
  // JSON-array form (download_uri/size) was retired; these replace it.
  jsonl_download_uri: string;
  compressed_size?: number;
};

type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
};

/**
 * One face of a card.
 *
 * Single-faced cards carry these fields at the top level. Transform and modal
 * double-faced cards do not: they have no top-level mana cost, oracle text,
 * colours or stats at all, only a `card_faces` array. Anything reading a cost
 * or a rules text therefore has to fall back to the front face.
 */
export type ScryfallFace = {
  oracle_id?: string;
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  artist?: string;
  image_uris?: ScryfallImageUris;
};

/**
 * Prices as Scryfall publishes them: strings, or null where that finish does
 * not exist or has no recent sale. USD is TCGplayer-derived, EUR is Cardmarket.
 */
export type ScryfallPrices = {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  eur_foil?: string | null;
  tix?: string | null;
};

export type ScryfallCard = ScryfallFace & {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name?: string;
  set_type?: string;
  collector_number: string;
  rarity?: string;
  type_line?: string;
  released_at?: string;
  lang?: string;
  digital?: boolean;
  finishes?: string[];
  scryfall_uri?: string;
  layout?: string;
  cmc?: number;
  color_identity?: string[];
  keywords?: string[];
  image_uris?: ScryfallImageUris;
  /** Present on double-faced/split cards, which carry their detail per face. */
  card_faces?: ScryfallFace[];
  prices?: ScryfallPrices;
  tcgplayer_id?: number;
  purchase_uris?: { tcgplayer?: string; cardmarket?: string; cardhoarder?: string };
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

  // Detail columns, added in migration 00000000000007.
  mana_cost: string | null;
  cmc: number | null;
  colors: string[] | null;
  color_identity: string[] | null;
  oracle_text: string | null;
  flavor_text: string | null;
  keywords: string[] | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  artist: string | null;
  layout: string | null;
  card_faces: ScryfallFace[] | null;
  set_type: string | null;

  // Price columns, added in migration 00000000000011.
  price_usd: number | null;
  price_usd_foil: number | null;
  price_usd_etched: number | null;
  price_eur: number | null;
  price_eur_foil: number | null;
  tcgplayer_id: number | null;
  purchase_uri: string | null;
  prices_updated_at: string;
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

  /**
   * Scryfall sends prices as strings, and null where a finish has no recent
   * sale. Number("") is 0, which would claim a card is free, so anything that
   * is not a finite positive number becomes null and is reported as "no price"
   * rather than as zero.
   */
  const price = (raw: string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  // Transform and modal double-faced cards carry no top-level cost, rules text,
  // colours or stats — only faces. Fall back to the front face, which is the
  // same face the image already comes from, so the panel stays self-consistent.
  const front = card.card_faces?.[0];
  const faceOr = <K extends keyof ScryfallFace>(key: K): NonNullable<ScryfallFace[K]> | null =>
    (card[key] as ScryfallFace[K]) ?? front?.[key] ?? null;

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

    mana_cost: faceOr("mana_cost"),
    // A real 0 is meaningful, so only undefined becomes null.
    cmc: card.cmc ?? null,
    colors: card.colors ?? front?.colors ?? null,
    color_identity: card.color_identity ?? null,
    oracle_text: faceOr("oracle_text"),
    flavor_text: faceOr("flavor_text"),
    keywords: card.keywords ?? null,
    power: faceOr("power"),
    toughness: faceOr("toughness"),
    loyalty: faceOr("loyalty"),
    artist: card.artist ?? front?.artist ?? null,
    layout: card.layout ?? null,
    // Only stored when there is genuinely more than one face to show.
    card_faces: card.card_faces && card.card_faces.length > 1 ? card.card_faces : null,
    set_type: card.set_type ?? null,

    price_usd: price(card.prices?.usd),
    price_usd_foil: price(card.prices?.usd_foil),
    price_usd_etched: price(card.prices?.usd_etched),
    price_eur: price(card.prices?.eur),
    price_eur_foil: price(card.prices?.eur_foil),
    tcgplayer_id: card.tcgplayer_id ?? null,
    purchase_uri: card.purchase_uris?.tcgplayer ?? null,
    // Stamped with the run, so the UI can say how old a number is.
    prices_updated_at: syncedAt,
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
