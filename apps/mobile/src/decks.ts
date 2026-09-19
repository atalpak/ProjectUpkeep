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
  tags: string[];
  notes: string | null;
  /** Visible to accepted friends. */
  isPublic: boolean;
  commanderCardId: string | null;
  commanderName: string | null;
  commanderImageUriSmall: string | null;
  /** The commander's illustration alone, for the banner. */
  commanderArt: string | null;
};

export async function fetchDeckHeader(userId: string, deckId: string): Promise<DeckHeader> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('locations')
    .select('id,name,format,tags,notes,is_public,commander_card_id')
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
  let commanderArt: string | null = null;
  if (data.commander_card_id) {
    // src/lib/collection/queries.ts resolves a deck's commander display the
    // same way: commander_card_id -> cards.name / image_uri_small, batched
    // separately from the deck row itself (migration 18 — commander_card_id
    // names a printing on the decklist, not a specific owned copy, so this
    // is a plain reference-data lookup with no owner filter of its own; the
    // owner check already happened on the `locations` row above).
    const { data: commander } = await backend
      .from('cards')
      .select('name,image_uri_small,image_uri')
      .eq('scryfall_id', data.commander_card_id)
      .maybeSingle();
    commanderName = commander?.name ?? null;
    commanderImageUriSmall = commander?.image_uri_small ?? null;
    commanderArt = artCropUrl(commander?.image_uri ?? null);
  }

  return {
    id: data.id, name: data.name, format: data.format, tags: (data.tags as string[] | null) ?? [], notes: (data.notes as string | null) ?? null, isPublic: !!data.is_public,
    commanderCardId: (data.commander_card_id as string | null) ?? null, commanderName, commanderImageUriSmall, commanderArt,
  };
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
  /**
   * Carried through so the sleeve/unsleeve pickers (fetchSpareStacks /
   * fetchSleevedStacks) can group by the same "any printing of this card"
   * key cardKey() uses above, rather than the one printing this line happens
   * to name.
   */
  oracleId: string | null;
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
      oracleId: card?.oracle_id ?? null,
    };
  });

  // Matches the collection screen's sort convention. No sectioning by type
  // this phase — deferred, see this feature's spec (would need promoting
  // deck-view.ts's grouping logic into the shared package).
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

// ---------------------------------------------------------------------------
// Sleeve / unsleeve pickers — phase 4b/4c of the mobile initiative.
//
// Both pickers list exact card_instances rows (a physical stack), because
// apply_stack_move (migration 38) moves a specific stack, not "some copies of
// a card" — the same reason the web app's sleeveCopies/unsleeveCopies pick a
// smallest-suitable-stack-first source row before ever calling the database.
// This phase deliberately keeps the UX to "pick one stack, move some or all
// of it" rather than reimplementing that multi-source auto-fill: one
// apply_stack_move call always moves from exactly one source row, so filling
// a shortfall from several stacks at once would need several calls, and the
// picker already lets a user do that themselves one tap at a time.
// ---------------------------------------------------------------------------

export type SleeveCandidate = {
  id: string;
  cardId: string;
  condition: string;
  finish: string;
  language: string;
  quantity: number;
  locationName: string;
  setCode: string;
  collectorNumber: string;
};

type RawSleeveCandidateRow = {
  id: string;
  card_id: string;
  condition: string;
  finish: string;
  language: string;
  quantity: number;
  locations: { id: string; name: string; type: string } | null;
  cards: { oracle_id: string | null; name: string; set_code: string; collector_number: string } | null;
};

/**
 * Every owned stack of `oracleId` (any printing) NOT already sleeved into
 * *this* deck — spare copies in Unsorted, another box, a binder, or a
 * different deck. Sleeving out of a different deck is allowed here (the web
 * app's sleeveCopies deliberately excludes it, "a different decision, made on
 * that deck's page" — but this phase's picker shows the location name on
 * every row, so moving a card out of another deck is visible and explicit,
 * not accidental).
 */
export async function fetchSpareStacks(
  userId: string,
  deckId: string,
  oracleId: string | null,
  cardName: string,
): Promise<SleeveCandidate[]> {
  if (!backend) throw new Error('Not connected.');
  // Filtered server-side by card identity, not just by owner: this used to
  // fetch up to 1000 of the account's card_instances rows with NO card
  // filter at all and narrow to `oracleId`/`cardName` in JS afterward, which
  // silently dropped a card's spare copies past the 1000-row cap for any
  // collection bigger than that — the picker then confidently reported "no
  // spare copies" instead of erroring. `cards!inner(...)` below turns the
  // embedded `cards` filter into an actual join-time filter (PostgREST
  // requires the inner join for an embedded-resource filter to apply), so
  // the 1000-row limit is now a guard on "copies of this one card", the same
  // bounded-in-practice assumption fetchDeckCards already makes, not a
  // meaningful truncation risk.
  let query = backend
    .from('card_instances')
    .select(
      'id,card_id,condition,finish,language,quantity,locations!location_id(id,name,type),cards!inner(oracle_id,name,set_code,collector_number)',
    )
    // owner_user_id is mandatory, not RLS's job alone: migration 9 makes a
    // friend's tradable-binder rows genuinely readable, and an unscoped
    // select would offer someone else's cards as sleeve candidates.
    .eq('owner_user_id', userId);
  // Same cardKey convention as fetchDeckCards/fetchSleevedStacks: oracle_id
  // is the primary match (stable across printings/reprints — "any printing
  // of this card" is what sleeving cares about), name is only the fallback
  // for the rare card missing an oracle id. ilike with no wildcard chars in
  // `cardName` is a case-insensitive exact match, mirroring the JS
  // `.toLowerCase()` comparison this replaces.
  query = oracleId ? query.eq('cards.oracle_id', oracleId) : query.ilike('cards.name', cardName);
  const { data, error } = await query.limit(1000);
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as RawSleeveCandidateRow[];
  return rows
    .filter((row) => {
      // Already sleeved into this exact deck — that is what fetchDeckCards's
      // "sleeved" count already reports, not a spare stack to sleeve from.
      return row.locations?.id !== deckId;
    })
    .map((row) => ({
      id: row.id,
      cardId: row.card_id,
      condition: row.condition,
      finish: row.finish,
      language: row.language,
      quantity: row.quantity,
      locationName: row.locations?.name ?? 'Unsorted',
      setCode: row.cards?.set_code ?? '',
      collectorNumber: row.cards?.collector_number ?? '',
    }))
    .sort((a, b) => a.quantity - b.quantity);
}

/**
 * Every stack of `oracleId` (any printing) physically sleeved into this deck
 * right now — the candidates an unsleeve picker moves back to Unsorted.
 */
export async function fetchSleevedStacks(
  userId: string,
  deckId: string,
  oracleId: string | null,
  cardName: string,
): Promise<SleeveCandidate[]> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('card_instances')
    .select('id,card_id,condition,finish,language,quantity,locations!location_id(id,name,type),cards(oracle_id,name,set_code,collector_number)')
    // Mandatory owner filter for the same reason as fetchSpareStacks — this
    // deck's own card_instances rows still need to be this account's, not
    // merely readable through RLS.
    .eq('owner_user_id', userId)
    .eq('location_id', deckId)
    .limit(1000);
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as RawSleeveCandidateRow[];
  return rows
    .filter((row) => {
      const card = row.cards;
      return oracleId ? card?.oracle_id === oracleId : card?.name?.toLowerCase() === cardName.toLowerCase();
    })
    .map((row) => ({
      id: row.id,
      cardId: row.card_id,
      condition: row.condition,
      finish: row.finish,
      language: row.language,
      quantity: row.quantity,
      locationName: row.locations?.name ?? 'Unsorted',
      setCode: row.cards?.set_code ?? '',
      collectorNumber: row.cards?.collector_number ?? '',
    }))
    .sort((a, b) => a.quantity - b.quantity);
}

// ---------------------------------------------------------------------------
// The deck list as tiles: commander art, colour identity, and how much of each
// list is physically sleeved. Mirrors the web app's getDecks()
// (src/lib/collection/queries.ts) in four reads for all decks at once, not
// one per deck.
// ---------------------------------------------------------------------------

export type DeckTile = {
  id: string;
  name: string;
  format: string | null;
  /** Visible to accepted friends. */
  isPublic: boolean;
  /** Cards the decklist asks for (sum of deck_cards.quantity). */
  cardCount: number;
  /** Distinct card names on the list. */
  uniqueCount: number;
  /** Copies physically sleeved in, per list entry and capped at what the entry asks for. */
  sleevedCount: number;
  commanderName: string | null;
  /** The commander's illustration alone, for the tile background. */
  commanderArt: string | null;
  /** The commander's colour identity (W U B R G), empty with no commander. */
  commanderColors: string[];
};

/** Scryfall's own way to get the illustration crop of a card image: swap one path segment. */
export function artCropUrl(imageUri: string | null): string | null {
  return imageUri ? imageUri.replace(/\/(?:small|normal|large)\/front\//, '/art_crop/front/') : null;
}

const MAX_TILE_ROWS = 20_000;

export async function fetchDeckTiles(userId: string): Promise<DeckTile[]> {
  if (!backend) throw new Error('Not connected.');
  const [decksRes, listRes, sleevedRes] = await Promise.all([
    backend
      .from('locations')
      .select('id,name,format,is_public,commander_card_id')
      // Mandatory: a friend's public deck's `locations` row is readable through
      // RLS (migration 35), so ownership has to be asked for explicitly.
      .eq('user_id', userId)
      .eq('type', 'deck')
      .order('name')
      .limit(1000),
    backend
      .from('deck_cards')
      .select('deck_id,quantity,cards(name,oracle_id),locations!inner(user_id)')
      // !inner + this filter: a friend's public deck_cards rows are readable too.
      .eq('locations.user_id', userId)
      .limit(MAX_TILE_ROWS),
    backend
      .from('collection_entries')
      .select('location_id,quantity,card_oracle_id,card_name')
      .eq('owner_user_id', userId)
      .eq('location_type', 'deck')
      .limit(MAX_TILE_ROWS),
  ]);
  for (const res of [decksRes, listRes, sleevedRes]) {
    if (res.error) {
      if (res.error.code === '42501' || res.error.code === 'PGRST301') throw new CollectionAuthError(res.error.message);
      throw new Error(res.error.message);
    }
  }

  // What is physically in each deck, by card identity.
  const sleevedByDeck = new Map<string, Map<string, number>>();
  for (const r of (sleevedRes.data ?? []) as unknown as { location_id: string | null; quantity: number; card_oracle_id: string | null; card_name: string }[]) {
    if (!r.location_id) continue;
    const key = cardKey(r.card_oracle_id, r.card_name);
    const forDeck = sleevedByDeck.get(r.location_id) ?? new Map<string, number>();
    forDeck.set(key, (forDeck.get(key) ?? 0) + r.quantity);
    sleevedByDeck.set(r.location_id, forDeck);
  }

  const total = new Map<string, number>();
  const names = new Map<string, Set<string>>();
  const sleeved = new Map<string, number>();
  for (const r of (listRes.data ?? []) as unknown as { deck_id: string; quantity: number; cards: { name: string; oracle_id: string | null } | null }[]) {
    total.set(r.deck_id, (total.get(r.deck_id) ?? 0) + r.quantity);
    if (r.cards?.name) {
      const set = names.get(r.deck_id) ?? new Set<string>();
      set.add(r.cards.name.toLowerCase());
      names.set(r.deck_id, set);
    }
    const inBox = sleevedByDeck.get(r.deck_id)?.get(cardKey(r.cards?.oracle_id ?? null, r.cards?.name ?? '')) ?? 0;
    sleeved.set(r.deck_id, (sleeved.get(r.deck_id) ?? 0) + Math.min(inBox, r.quantity));
  }

  const decks = (decksRes.data ?? []) as unknown as { id: string; name: string; format: string | null; is_public: boolean | null; commander_card_id: string | null }[];
  // Commanders in one lookup, not one per deck.
  const commanderIds = [...new Set(decks.map(d => d.commander_card_id).filter((v): v is string => !!v))];
  const commanders = new Map<string, { name: string; art: string | null; colors: string[] }>();
  if (commanderIds.length > 0) {
    const { data, error } = await backend.from('cards').select('scryfall_id,name,flavor_name,image_uri,color_identity').in('scryfall_id', commanderIds);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as unknown as { scryfall_id: string; name: string; flavor_name: string | null; image_uri: string | null; color_identity: string[] | null }[]) {
      commanders.set(c.scryfall_id, { name: c.flavor_name ? `${c.name} (${c.flavor_name})` : c.name, art: artCropUrl(c.image_uri), colors: c.color_identity ?? [] });
    }
  }

  return decks.map(d => {
    const commander = d.commander_card_id ? commanders.get(d.commander_card_id) : undefined;
    return {
      id: d.id, name: d.name, format: d.format, isPublic: !!d.is_public,
      cardCount: total.get(d.id) ?? 0, uniqueCount: names.get(d.id)?.size ?? 0, sleevedCount: sleeved.get(d.id) ?? 0,
      commanderName: commander?.name ?? null, commanderArt: commander?.art ?? null, commanderColors: commander?.colors ?? [],
    };
  });
}

/** Starts an empty deck (a `locations` row of type deck), as the web app's "Start a deck" does. */
export async function createDeck(userId: string, name: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the deck a name.');
  if (trimmed.length > 80) throw new Error('That name is too long.');
  const { error } = await backend.from('locations').insert({ user_id: userId, name: trimmed, type: 'deck' });
  if (error) throw new Error(error.message.includes('duplicate key') ? 'You already have a deck called that.' : error.message);
}

/**
 * How many copies of each card (by card identity, not printing) sit OUTSIDE
 * every deck: the spares a list entry could still be sleeved from. Copies
 * already in a deck are committed there, which is what the web app's
 * availability means too.
 */
export async function fetchSpareCounts(userId: string): Promise<Map<string, number>> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('collection_entries')
    .select('card_oracle_id,card_name,quantity')
    .eq('owner_user_id', userId)
    .or('location_type.is.null,location_type.neq.deck')
    .limit(MAX_TILE_ROWS);
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  const spare = new Map<string, number>();
  for (const r of (data ?? []) as unknown as { card_oracle_id: string | null; card_name: string; quantity: number }[]) {
    const key = cardKey(r.card_oracle_id, r.card_name);
    spare.set(key, (spare.get(key) ?? 0) + r.quantity);
  }
  return spare;
}

/** The identity a list entry is matched on ("any printing counts"), exported so screens can look a spare count up. */
export function entryKey(entry: { oracleId: string | null; name: string }): string {
  return cardKey(entry.oracleId, entry.name);
}

// ---------------------------------------------------------------------------
// Deck management: rename, details, sharing, delete.
//
// Every write below mirrors src/app/(app)/decks/actions.ts (renameDeck,
// updateDeckDetails, setDeckPublic, deleteDeck) column for column, with two
// differences on purpose. Web leans on RLS's own-row update policy alone; here
// each write also carries .eq('user_id', userId), because migration 35 made a
// friend's public deck row readable and constraint 3 says "mine" is something
// the query states, not something RLS implies. And each write asks for the
// row back, so "nothing matched" (a deck deleted on another device) surfaces
// as a sentence instead of a silent success. Nothing here touches deck_cards:
// list editing stays web-only.
//
// The validation below is a small local copy of updateDeckDetails' rules. The
// web keeps them inline in a server action, so there is nothing importable to
// share yet; the limits (80 / 40 / 20 tags of 40 / 5000) come from that action
// and migration 21's CHECK constraints.
// ---------------------------------------------------------------------------

export const DECK_NAME_MAX = 80;
export const DECK_FORMAT_MAX = 40;
export const DECK_NOTES_MAX = 5000;
export const DECK_TAG_MAX = 40;
export const DECK_TAGS_MAX = 20;

/** Suggestions only, as on the web (src/lib/types.ts): a format or tag can be anything. */
export const DECK_FORMATS = ['Commander', 'Modern', 'Standard', 'Pioneer', 'Legacy', 'Vintage', 'Pauper', 'Historic', 'Brawl', 'Limited', 'Other'] as const;
export const DECK_ARCHETYPES = ['Aggro', 'Midrange', 'Control', 'Combo', 'Tempo', 'Ramp', 'Aggro-Control', 'Prison', 'Stax', 'Tribal', 'Toolbox', 'Voltron'] as const;

function deckWriteError(message: string): Error {
  return new Error(message.includes('duplicate key') ? 'You already have a deck called that.' : message);
}

function checkDeckName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the deck a name.');
  if (trimmed.length > DECK_NAME_MAX) throw new Error('That name is too long.');
  return trimmed;
}

/** Trim, clamp each tag, drop blanks and case-insensitive duplicates, cap the count -- as the web does. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw) {
    const tag = part.trim().slice(0, DECK_TAG_MAX);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= DECK_TAGS_MAX) break;
  }
  return tags;
}

export type DeckDetailsInput = { name: string; format: string; tags: string[]; notes: string };

async function updateDeckRow(userId: string, deckId: string, patch: Record<string, unknown>): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend
    .from('locations')
    .update(patch)
    .eq('id', deckId)
    .eq('user_id', userId)
    .eq('type', 'deck')
    .select('id');
  if (error) throw deckWriteError(error.message);
  if (!data?.length) throw new Error('That deck could not be found, or is no longer yours.');
}

export async function renameDeck(userId: string, deckId: string, name: string): Promise<void> {
  await updateDeckRow(userId, deckId, { name: checkDeckName(name) });
}

/** Name, format, tags and notes in one write, so a save is all-or-nothing (as the web's updateDeckDetails). */
export async function updateDeckDetails(userId: string, deckId: string, input: DeckDetailsInput): Promise<void> {
  const name = checkDeckName(input.name);
  const format = input.format.trim();
  if (format.length > DECK_FORMAT_MAX) throw new Error('That format name is too long.');
  if (input.notes.length > DECK_NOTES_MAX) throw new Error(`Those notes are too long (${DECK_NOTES_MAX} characters max).`);
  await updateDeckRow(userId, deckId, {
    name,
    format: format === '' ? null : format,
    notes: input.notes.trim() === '' ? null : input.notes,
    tags: normalizeTags(input.tags),
  });
}

/** Shares the decklist (never the sleeved copies) with accepted friends: `locations.is_public`, migration 35. */
export async function setDeckPublic(userId: string, deckId: string, isPublic: boolean): Promise<void> {
  await updateDeckRow(userId, deckId, { is_public: isPublic });
}

/** Non-destructive, like deleteLocation: locations.location_id is ON DELETE SET NULL, so sleeved cards go back to Unsorted. */
export async function deleteDeck(userId: string, deckId: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend.from('locations').delete().eq('id', deckId).eq('user_id', userId).eq('type', 'deck').select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('That deck could not be found, or is no longer yours.');
}
