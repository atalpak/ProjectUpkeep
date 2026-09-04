/**
 * Turning a flat `collection_entries` row back into the nested shape the UI
 * uses.
 *
 * The view exists so the database can filter, sort and paginate — which it can
 * only do over top-level columns, hence the flattening. Nothing above this
 * module should know that happened, so the reshaping lives here and everything
 * downstream keeps working with `CardInstanceWithCard` as before.
 *
 * Pure, so it can be tested without a database.
 */

import type { Card, CardInstanceWithCard, LocationType } from "@/lib/types";

/** One row of public.collection_entries, as PostgREST returns it. */
export type CollectionEntryRow = Record<string, unknown>;

const CARD_COLUMNS: Array<keyof Card> = [
  "scryfall_id",
  "oracle_id",
  "name",
  "set_code",
  "set_name",
  "collector_number",
  "rarity",
  "type_line",
  "released_at",
  "image_uri",
  "image_uri_small",
  "scryfall_uri",
  "available_finishes",
  "lang",
  "digital",
  "last_synced_at",
  "mana_cost",
  "cmc",
  "colors",
  "color_identity",
  "oracle_text",
  "flavor_text",
  "keywords",
  "power",
  "toughness",
  "loyalty",
  "artist",
  "layout",
  "card_faces",
  "set_type",
  "price_usd",
  "price_usd_foil",
  "price_usd_etched",
  "price_eur",
  "price_eur_foil",
  "tcgplayer_id",
  "purchase_uri",
  "prices_updated_at",
];

/** Every column the view exposes, so a select can ask for exactly them. */
export const ENTRY_COLUMNS = [
  "id",
  "owner_user_id",
  "card_id",
  "location_id",
  "condition",
  "finish",
  "language",
  "quantity",
  "notes",
  "acquired_at",
  "created_at",
  "updated_at",
  ...CARD_COLUMNS.map((c) => `card_${c}`),
  "location_name",
  "location_type",
].join(", ");

/**
 * The columns behind select-all: which rows match, and how many cards each
 * stands for. No card or location data — this query runs over the whole
 * filtered set, so it stays as narrow as it can.
 */
export const ENTRY_ID_COLUMN = "id, quantity";

export function toCardInstanceWithCard(row: CollectionEntryRow): CardInstanceWithCard {
  const card = {} as Record<string, unknown>;
  for (const column of CARD_COLUMNS) card[column] = row[`card_${column}`];

  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    card_id: row.card_id,
    location_id: row.location_id,
    condition: row.condition,
    finish: row.finish,
    language: row.language,
    quantity: row.quantity,
    notes: row.notes,
    acquired_at: row.acquired_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // card_id is NOT NULL behind a foreign key and the view inner-joins cards,
    // so a row without its printing cannot arrive here. Guarding anyway costs
    // nothing and keeps the type honest.
    cards: row.card_scryfall_id ? (card as unknown as Card) : null,
    locations: row.location_id
      ? {
          id: row.location_id as string,
          name: (row.location_name as string) ?? "",
          type: row.location_type as LocationType,
        }
      : null,
  } as CardInstanceWithCard;
}
