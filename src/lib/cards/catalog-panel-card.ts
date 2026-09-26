import type { CatalogCard } from "@upkeep/domain";
import type { Card } from "@/lib/types";

/**
 * A search result as the card panel's `Card`, for printings that may not exist
 * in the local mirror (new previews, digital-only cards, other languages). The
 * panel accepts a card object directly, so opening a result never depends on a
 * local row. Fields the search payload does not carry stay null rather than
 * being guessed; `available_finishes` is empty because the list response does
 * not state them, which keeps physical-copy actions from assuming a finish.
 */
export function catalogCardToPanelCard(c: CatalogCard, inCatalog = true): Card {
  const num = (v: string | null) => (v === null ? null : Number.parseFloat(v));
  return {
    scryfall_id: c.id,
    oracle_id: c.oracleId,
    name: c.name,
    flavor_name: c.flavorName ?? null,
    set_code: c.set,
    set_name: c.setName || null,
    collector_number: c.collectorNumber,
    rarity: c.rarity || null,
    type_line: c.typeLine ?? c.faces[0]?.typeLine ?? null,
    released_at: c.releasedAt || null,
    image_uri: c.imageNormal,
    image_uri_small: c.imageSmall,
    scryfall_uri: c.scryfallUri || null,
    available_finishes: [],
    lang: c.lang,
    digital: c.digital,
    // Convention: an empty `last_synced_at` means "not in Upkeep's catalog", so
    // the panel view-only-explains instead of offering physical-copy actions.
    last_synced_at: inCatalog ? new Date(0).toISOString() : "",
    mana_cost: c.manaCost ?? c.faces[0]?.manaCost ?? null,
    cmc: null,
    colors: null,
    color_identity: null,
    oracle_text: c.oracleText ?? null,
    flavor_text: null,
    keywords: null,
    power: c.faces[0]?.power ?? null,
    toughness: c.faces[0]?.toughness ?? null,
    loyalty: c.faces[0]?.loyalty ?? null,
    artist: c.faces[0]?.artist ?? null,
    layout: c.layout,
    card_faces: c.faces.length
      ? c.faces.map((f) => ({
          name: f.name,
          mana_cost: f.manaCost,
          type_line: f.typeLine,
          oracle_text: f.oracleText,
          flavor_text: f.flavorText,
          power: f.power,
          toughness: f.toughness,
          loyalty: f.loyalty,
          artist: f.artist,
          image_uris: {
            small: f.imageSmall ?? undefined,
            normal: f.imageNormal ?? undefined,
            large: f.imageLarge ?? undefined,
          },
        }))
      : null,
    set_type: null,
    produced_mana: null,
    game_changer: null,
    price_usd: num(c.prices.usd),
    price_usd_foil: num(c.prices.usd_foil),
    price_usd_etched: null,
    price_eur: num(c.prices.eur),
    price_eur_foil: null,
    tcgplayer_id: null,
    purchase_uri: null,
    prices_updated_at: null,
  };
}
