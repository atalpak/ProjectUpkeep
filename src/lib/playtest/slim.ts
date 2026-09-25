/**
 * The slim per-card record the play page ships to the browser.
 *
 * `getDeckList()` returns whole `cards` rows, about forty columns each, prices
 * and search metadata included. The table needs a dozen of them, and a
 * 100-card deck sent whole is over 100KB of props for nothing. The server
 * page maps every entry through `slimEntry` so the client receives only what it
 * draws or reads: names, art, mana, type, oracle text for the inspector, and
 * faces. `game-start.ts` accepts this shape (a `DeckListEntry` is assignable to
 * it, which is how the tests keep building their fixtures).
 *
 * Type-only imports from the collection code: erased at compile time, which is
 * the one form of import the lint fence allows here.
 */

import type { DeckListEntry } from "@/lib/collection/queries";
import type { Card, CardFace } from "@/lib/types";

export type StartCard = Pick<
  Card,
  | "scryfall_id"
  | "oracle_id"
  | "name"
  | "type_line"
  | "cmc"
  | "mana_cost"
  | "produced_mana"
  | "oracle_text"
  | "image_uri"
  | "image_uri_small"
  | "power"
  | "toughness"
  | "loyalty"
  | "card_faces"
>;

export type StartEntry = {
  id: string;
  card_id: string;
  quantity: number;
  cards: StartCard | null;
};

function slimFace(face: CardFace): CardFace {
  return {
    name: face.name,
    mana_cost: face.mana_cost,
    type_line: face.type_line,
    oracle_text: face.oracle_text,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    image_uris: face.image_uris ? { normal: face.image_uris.normal } : undefined,
  };
}

export function slimEntry(entry: DeckListEntry): StartEntry {
  const card = entry.cards;
  return {
    id: entry.id,
    card_id: entry.card_id,
    quantity: entry.quantity,
    cards: card
      ? {
          scryfall_id: card.scryfall_id,
          oracle_id: card.oracle_id,
          name: card.name,
          type_line: card.type_line,
          cmc: card.cmc,
          mana_cost: card.mana_cost,
          produced_mana: card.produced_mana,
          oracle_text: card.oracle_text,
          image_uri: card.image_uri,
          image_uri_small: card.image_uri_small,
          power: card.power,
          toughness: card.toughness,
          loyalty: card.loyalty,
          card_faces: card.card_faces && card.card_faces.length > 1 ? card.card_faces.map(slimFace) : null,
        }
      : null,
  };
}
