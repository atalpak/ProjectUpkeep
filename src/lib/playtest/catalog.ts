/**
 * The read-only card catalogue the table consults for what a game object does
 * not carry: oracle text and mana cost for the inspector, colours for sorting
 * the hand, the faces of a double-faced card. Built once, from the slim
 * entries the page loaded (slim.ts), keyed by printing id.
 *
 * Game objects deliberately stay small (they are what gets saved and shared);
 * anything that can be looked up from the deck is looked up here instead. A
 * card that is not in the deck (a token or extra added from search) is not in
 * this map, and the inspector fetches `/api/cards/[id]` for it on demand.
 */

import type { StartEntry } from "./slim";

export type CatalogFace = { name?: string; type_line?: string; mana_cost?: string; oracle_text?: string; image?: string };

export type CatalogInfo = {
  typeLine: string | null;
  manaCost: string | null;
  oracleText: string | null;
  loyalty: string | null;
  colors: string[];
  faces: CatalogFace[] | null;
};

export function buildCatalog(entries: readonly StartEntry[]): Map<string, CatalogInfo> {
  const map = new Map<string, CatalogInfo>();
  for (const entry of entries) {
    const card = entry.cards;
    if (!card || map.has(card.scryfall_id)) continue;
    map.set(card.scryfall_id, {
      typeLine: card.type_line,
      manaCost: card.mana_cost,
      oracleText: card.oracle_text,
      loyalty: card.loyalty,
      colors: card.colors ?? [],
      faces: card.card_faces
        ? card.card_faces.map((f) => ({ name: f.name, type_line: f.type_line, mana_cost: f.mana_cost, oracle_text: f.oracle_text, image: f.image_uris?.normal }))
        : null,
    });
  }
  return map;
}

/** What the inspector shows for one face of a card, from the catalogue. */
export function textFor(info: CatalogInfo | undefined, face: "front" | "back"): { name?: string; typeLine: string | null; manaCost: string | null; text: string | null } | null {
  if (!info) return null;
  if (info.faces && info.faces.length > 1) {
    const f = info.faces[face === "back" ? 1 : 0];
    return { name: f.name, typeLine: f.type_line ?? null, manaCost: f.mana_cost ?? null, text: f.oracle_text ?? null };
  }
  return { typeLine: info.typeLine, manaCost: info.manaCost, text: info.oracleText };
}
