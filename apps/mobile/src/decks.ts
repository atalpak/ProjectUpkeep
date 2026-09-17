import { backend } from './backend';
import { CollectionAuthError } from './collection';

// Read-only "browse my decks" queries — phase 4a of the mobile initiative,
// following collection.ts's pattern of one small module per screen's data
// needs. See supabase/migrations/00000000000010_deck_cards.sql's header
// before touching any of this: a deck has TWO card sets that must never be
// conflated —
//
//   * deck_cards        — the intended decklist. Can include cards not owned
//                          yet. "quantity" here means "wanted", not "have".
//   * card_instances     — what is physically sleeved, via location_id. Not
//                          linked to a list entry; sleeved-ness is answered by
//                          counting, matched to a list entry by card identity
//                          (see cardKey below), the same way the web app's
//                          src/lib/collection/availability.ts counts what's
//                          free to sleeve. That file is server-only and not
//                          resolvable from Metro, so this is a small
//                          from-scratch re-implementation of its convention,
//                          not an import of it.
//
// A deck itself is a `locations` row with type = 'deck'. No pagination
// anywhere in this module: a deck is bounded in practice (tens to ~100
// entries) unlike the whole-collection screen in collection.ts, which range-
// pages because a collection is not bounded. `.limit(1000)` below is a guard
// against something going wrong, not a page size.

export type DeckSummary = {
  id: string;
  name: string;
  format: string | null;
  tags: string[];
  color: string | null;
};

export async function fetchDecks(userId: string): Promise<DeckSummary[]> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('locations')
    .select('id,name,format,tags,color')
    // Mandatory, not optional: migration 35 makes a friend's is_public deck's
    // `locations` row readable through RLS (so the friend's own device can
    // list it, or so a future "browse a friend's public decks" screen could).
    // Without this filter a friend's deck would silently appear in this
    // account's own deck list — the exact bug category phase 1 already hit
    // once with `owner_user_id` vs `user_id` confusion; `locations` is keyed
    // by `user_id`, not `owner_user_id` (that column belongs to
    // card_instances — see migration 4's header).
    .eq('user_id', userId)
    .eq('type', 'deck')
    .order('name')
    .limit(1000);
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as DeckSummary[];
}

export type DeckHeader = {
  id: string;
  name: string;
  format: string | null;
  commanderName: string | null;
  commanderImageUriSmall: string | null;
};

export async function fetchDeckHeader(userId: string, deckId: string): Promise<DeckHeader> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('locations')
    .select('id,name,format,commander_card_id')
    // Same reasoning as fetchDecks: `id` alone resolves "the deck with this
    // id", which RLS would happily hand back for a friend's public deck too.
    // `user_id` is what actually makes this "my deck, not any deck".
    .eq('id', deckId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  if (!data) throw new Error('That deck could not be found, or is no longer yours.');

  let commanderName: string | null = null;
  let commanderImageUriSmall: string | null = null;
  if (data.commander_card_id) {
    // src/lib/collection/queries.ts resolves a deck's commander display the
    // same way: commander_card_id -> cards.name / image_uri_small, batched
    // separately from the deck row itself (migration 18 — commander_card_id
    // names a printing on the decklist, not a specific owned copy, so this
    // is a plain reference-data lookup with no owner filter of its own; the
    // owner check already happened on the `locations` row above).
    const { data: commander } = await backend
      .from('cards')
      .select('name,image_uri_small')
      .eq('scryfall_id', data.commander_card_id)
      .maybeSingle();
    commanderName = commander?.name ?? null;
    commanderImageUriSmall = commander?.image_uri_small ?? null;
  }

  return { id: data.id, name: data.name, format: data.format, commanderName, commanderImageUriSmall };
}

export type DeckCardEntry = {
  id: string;
  cardId: string;
  /** Wanted quantity, from deck_cards — not how many are owned or sleeved. */
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
  typeLine: string | null;
  manaCost: string | null;
  imageUriSmall: string | null;
  rarity: string;
  /** How many of `quantity` are physically sleeved into this deck, capped at quantity. */
  sleeved: number;
};

type RawDeckCardRow = {
  id: string;
  deck_id: string;
  card_id: string;
  quantity: number;
  cards: {
    name: string;
    set_code: string;
    collector_number: string;
    type_line: string | null;
    mana_cost: string | null;
    image_uri_small: string | null;
    rarity: string;
    oracle_id: string | null;
  } | null;
};

type RawSleevedRow = { card_oracle_id: string | null; card_name: string; quantity: number };

// Groups every printing of a card under one key, mirroring
// src/lib/collection/availability.ts's cardKey: oracle_id is stable across
// printings/reprints, which is exactly the grouping "is this card sleeved"
// needs (a list entry for "4 Lightning Bolt" is satisfied by any printing of
// it). Name is the fallback for the rare row missing an oracle id.
function cardKey(oracleId: string | null, name: string): string {
  return oracleId ?? `name:${name.toLowerCase()}`;
}

export async function fetchDeckCards(userId: string, deckId: string): Promise<DeckCardEntry[]> {
  if (!backend) throw new Error('Not connected.');

  const listQuery = backend
    .from('deck_cards')
    // oracle_id is added to the columns beyond what renders, purely to make
    // the sleeved-count match above correct: matching on card_id (a specific
    // printing) would undercount a list entry whenever the sleeved copies are
    // a different printing than the one the list happens to reference — see
    // migration 10's header ("any four Lightning Bolts satisfy it, in any
    // printing").
    .select(
      'id,deck_id,card_id,quantity,cards(name,set_code,collector_number,type_line,mana_cost,image_uri_small,rarity,oracle_id),locations!inner(user_id)',
    )
    // deck_id alone means "the deck with this id" — any deck, including a
    // friend's public one (migration 35) — not "my deck". locations.user_id
    // is the actual owner check, joined in for exactly that reason.
    .eq('deck_id', deckId)
    // !inner above is mandatory: a left join would leave the embedded
    // `locations` object null on a non-matching row instead of excluding the
    // row, which would make this filter silently do nothing.
    .eq('locations.user_id', userId)
    .limit(1000);

  const sleevedQuery = backend
    .from('collection_entries')
    .select('card_oracle_id,card_name,quantity')
    // Mandatory for the same reason apps/mobile/src/collection.ts's page
    // query is: collection_entries runs with security_invoker, so RLS on the
    // underlying card_instances still applies, including the policy that
    // legitimately exposes a friend's tradable binder. Without this filter,
    // rows sharing this location_id but owned by someone else could be
    // counted as sleeved here.
    .eq('owner_user_id', userId)
    .eq('location_id', deckId)
    .limit(1000);

  const [{ data: list, error: listError }, { data: sleeved, error: sleevedError }] = await Promise.all([
    listQuery,
    sleevedQuery,
  ]);
  if (listError) {
    if (listError.code === '42501' || listError.code === 'PGRST301') throw new CollectionAuthError(listError.message);
    throw new Error(listError.message);
  }
  if (sleevedError) {
    if (sleevedError.code === '42501' || sleevedError.code === 'PGRST301') throw new CollectionAuthError(sleevedError.message);
    throw new Error(sleevedError.message);
  }

  const sleevedByKey = new Map<string, number>();
  for (const row of (sleeved ?? []) as unknown as RawSleevedRow[]) {
    const key = cardKey(row.card_oracle_id, row.card_name);
    sleevedByKey.set(key, (sleevedByKey.get(key) ?? 0) + row.quantity);
  }

  const entries = ((list ?? []) as unknown as RawDeckCardRow[]).map((row) => {
    const card = row.cards;
    const key = cardKey(card?.oracle_id ?? null, card?.name ?? '');
    // Capped at the wanted quantity: five sleeved copies against a wanted
    // quantity of four must read as "4/4 sleeved", not "125% sleeved".
    const sleeved = Math.min(sleevedByKey.get(key) ?? 0, row.quantity);
    return {
      id: row.id,
      cardId: row.card_id,
      quantity: row.quantity,
      name: card?.name ?? '(unknown card)',
      setCode: card?.set_code ?? '',
      collectorNumber: card?.collector_number ?? '',
      typeLine: card?.type_line ?? null,
      manaCost: card?.mana_cost ?? null,
      imageUriSmall: card?.image_uri_small ?? null,
      rarity: card?.rarity ?? '',
      sleeved,
    };
  });

  // Matches the collection screen's sort convention. No sectioning by type
  // this phase — deferred, see this feature's spec (would need promoting
  // deck-view.ts's grouping logic into the shared package).
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
