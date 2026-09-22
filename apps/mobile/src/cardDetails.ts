import { FINISHES, LruCache, regularFirst, rejectAfter, type Finish, type Printing } from '@upkeep/scan-core';
import { backend } from './backend';

// Data for the card details sheet: every printing of a card (public Scryfall
// data, no owner scoping -- see .claude/rules/data-access.md), what the signed
// in user already owns of it, and the wish-list write. The two user-specific
// queries scope on the user explicitly; RLS alone is not enough because a
// friend's trade binder is legitimately readable (CLAUDE.md constraint 3).

/** One face of a card. Single-faced cards have exactly one; transform and
 *  modal double-faced cards have two, each with its own art (`image`). Split
 *  and adventure cards have several faces on one image (`image` is null). */
export type CardFace = {
  name: string; manaCost: string | null; typeLine: string | null; oracleText: string | null; flavorText: string | null;
  power: string | null; toughness: string | null; loyalty: string | null; image: string | null;
};

export type CardPrinting = {
  id: string;
  oracleId: string;
  name: string;
  flavorName: string | null;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  releasedAt: string | null;
  setType: string | null;
  image: string | null;
  imageSmall: string | null;
  finishes: Finish[];
  language: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  artist: string | null;
  layout: string | null;
  faces: CardFace[];
  priceUsd: number | null;
  priceUsdFoil: number | null;
  priceUsdEtched: number | null;
  scryfallUri: string | null;
  /** False for a row from the light list query (no rules text, flavor or faces). The sheet fetches the full row for whichever printing is selected. */
  full: boolean;
};

/** How long the sheet waits on any one request before showing "Couldn't load -- Try again". */
export const REQUEST_TIMEOUT_MS = 8_000;

/** Plain-language text for a failed or timed-out request; never a raw driver message. */
export const LOAD_FAILED = 'Couldn’t load — check your connection and try again.';

/** Runs a request under the deadline. A timeout becomes the same shape as any other failure. */
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  return rejectAfter(work, REQUEST_TIMEOUT_MS);
}

type Row = {
  scryfall_id: string; oracle_id: string; name: string; flavor_name: string | null; set_code: string; set_name: string | null;
  collector_number: string; rarity: string; released_at: string | null; set_type: string | null; image_uri: string | null;
  image_uri_small: string | null; available_finishes: string[] | null; lang: string; mana_cost: string | null; type_line: string | null;
  oracle_text: string | null; flavor_text: string | null; power: string | null; toughness: string | null; loyalty: string | null;
  artist: string | null; layout: string | null; card_faces: RawFace[] | null; price_usd: number | string | null; price_usd_foil: number | string | null;
  price_usd_etched: number | string | null; scryfall_uri: string | null;
};

type RawFace = {
  name?: string; mana_cost?: string | null; type_line?: string | null; oracle_text?: string | null; flavor_text?: string | null;
  power?: string | null; toughness?: string | null; loyalty?: string | null; image_uris?: { normal?: string } | null;
};

const COLUMNS = 'scryfall_id,oracle_id,name,flavor_name,set_code,set_name,collector_number,rarity,released_at,set_type,image_uri,image_uri_small,available_finishes,lang,mana_cost,type_line,oracle_text,flavor_text,power,toughness,loyalty,artist,layout,card_faces,price_usd,price_usd_foil,price_usd_etched,scryfall_uri';

function facesOf(r: Row): CardFace[] {
  const raw = Array.isArray(r.card_faces) ? r.card_faces : [];
  if (raw.length < 2) {
    return [{ name: r.name, manaCost: r.mana_cost, typeLine: r.type_line, oracleText: r.oracle_text, flavorText: r.flavor_text, power: r.power, toughness: r.toughness, loyalty: r.loyalty, image: r.image_uri }];
  }
  return raw.map(f => ({
    name: f.name ?? r.name, manaCost: f.mana_cost ?? null, typeLine: f.type_line ?? null, oracleText: f.oracle_text ?? null, flavorText: f.flavor_text ?? null,
    power: f.power ?? null, toughness: f.toughness ?? null, loyalty: f.loyalty ?? null, image: f.image_uris?.normal ?? null,
  }));
}

const num = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// The printing list only needs what the chips and the default pick read. The
// heavy columns (rules text, flavor text, the card_faces JSON) are fetched for
// the ONE printing on screen (fetchPrinting), not for every printing of a name:
// "Lightning Bolt" is ~100 rows and card_faces is the widest column we have.
const LIGHT_COLUMNS = 'scryfall_id,oracle_id,name,flavor_name,set_code,set_name,collector_number,rarity,released_at,set_type,image_uri,image_uri_small,available_finishes,lang,mana_cost,type_line,power,toughness,loyalty,artist,layout,price_usd,price_usd_foil,price_usd_etched,scryfall_uri';

function toCardPrinting(r: Row, full: boolean): CardPrinting {
  return {
    full,
    id: r.scryfall_id, oracleId: r.oracle_id, name: r.name, flavorName: r.flavor_name, setCode: r.set_code, setName: r.set_name ?? r.set_code.toUpperCase(),
    collectorNumber: r.collector_number, rarity: r.rarity, releasedAt: r.released_at, setType: r.set_type, image: r.image_uri, imageSmall: r.image_uri_small,
    finishes: (r.available_finishes ?? []).filter((f): f is Finish => (FINISHES as readonly string[]).includes(f)),
    language: r.lang, manaCost: r.mana_cost, typeLine: r.type_line, oracleText: r.oracle_text ?? null, flavorText: r.flavor_text ?? null,
    power: r.power, toughness: r.toughness, loyalty: r.loyalty, artist: r.artist, layout: r.layout,
    faces: facesOf(r),
    priceUsd: num(r.price_usd), priceUsdFoil: num(r.price_usd_foil), priceUsdEtched: num(r.price_usd_etched), scryfallUri: r.scryfall_uri,
  };
}

/**
 * What a caller already knows about the copy it opens the sheet from (the
 * collection row: name, set, number, picture, prices). The sheet paints from
 * this at once with no network, then fills in the rest.
 */
export type CardSeed = {
  id: string; name: string; setCode: string; collectorNumber: string; rarity: string | null; typeLine: string | null;
  image: string | null; imageSmall: string | null;
  priceUsd: number | string | null; priceUsdFoil: number | string | null; priceUsdEtched: number | string | null;
};

/** A provisional printing from a seed: enough to draw the picture, name and price. `finishes` is empty
 *  until the real row arrives, which is also what keeps "Add to collection" off until then. */
export function seedToPrinting(s: CardSeed): CardPrinting {
  return {
    id: s.id, oracleId: '', name: s.name, flavorName: null, setCode: s.setCode, setName: s.setCode.toUpperCase(), collectorNumber: s.collectorNumber,
    rarity: s.rarity ?? '', releasedAt: null, setType: null, image: s.image, imageSmall: s.imageSmall, finishes: [], language: 'en',
    manaCost: null, typeLine: s.typeLine, oracleText: null, flavorText: null, power: null, toughness: null, loyalty: null, artist: null, layout: null,
    faces: [{ name: s.name, manaCost: null, typeLine: s.typeLine, oracleText: null, flavorText: null, power: null, toughness: null, loyalty: null, image: s.image }],
    priceUsd: num(s.priceUsd), priceUsdFoil: num(s.priceUsdFoil), priceUsdEtched: num(s.priceUsdEtched), scryfallUri: null, full: false,
  };
}

// Recent results, so reopening a card (or the one you just closed) paints with
// no network at all. Public Scryfall data only -- nothing user-specific is cached.
// Entries expire after CACHE_TTL_MS because they carry prices, which the daily
// sync changes: without it a long-lived app session would show yesterday's price.
export const CACHE_TTL_MS = 10 * 60_000;
const listCache = new LruCache<string, CardPrinting[]>(50, CACHE_TTL_MS);
const rowCache = new LruCache<string, CardPrinting>(50, CACHE_TTL_MS);

/** Instant, network-free lookups for the sheet's first paint. */
export const cachedPrintings = (name: string): CardPrinting[] | undefined => listCache.get(name);
export const cachedPrinting = (id: string): CardPrinting | undefined => rowCache.get(id);

/** Every non-digital printing of a card by exact name, newest first (light rows: see LIGHT_COLUMNS).
 *  Sorted here, not in SQL: cards.released_at has no index and an ordered query can time out (see cardSearch.ts).
 *  `cards.name` is indexed (migration 24), so the filter itself is an index scan. */
export async function fetchPrintings(name: string): Promise<{ printings: CardPrinting[]; error: string | null }> {
  if (!backend) return { printings: [], error: 'Card details need an internet connection and an account.' };
  const hit = listCache.get(name);
  if (hit) return { printings: hit, error: null };
  try {
    const { data, error } = await bounded(backend.from('cards').select(LIGHT_COLUMNS).eq('name', name).eq('digital', false).limit(500).returns<Row[]>());
    if (error) return { printings: [], error: LOAD_FAILED };
    const printings = (data ?? []).map(r => cachedPrinting(r.scryfall_id) ?? toCardPrinting(r, false));
    printings.sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
    if (printings.length > 0) listCache.set(name, printings);
    return { printings, error: null };
  } catch { return { printings: [], error: LOAD_FAILED }; }
}

/**
 * One printing by id with every column: a single primary-key row, far lighter
 * than the whole list a name like "Lightning Bolt" returns. Lets the sheet show
 * rules text and the price while the list is still on its way, and is how a
 * chosen printing gets its full detail. Null on any failure or a missing row.
 */
export async function fetchPrinting(id: string): Promise<CardPrinting | null> {
  if (!backend) return null;
  const hit = rowCache.get(id);
  if (hit) return hit;
  try {
    const { data, error } = await bounded(backend.from('cards').select(COLUMNS).eq('scryfall_id', id).eq('digital', false).maybeSingle<Row>());
    if (error || !data) return null;
    const p = toCardPrinting(data, true);
    rowCache.set(id, p);
    return p;
  } catch { return null; }
}

// Same ranking the web wish list uses (src/app/(app)/wants/actions.ts) so a
// card opens on a normal copy, not a promo or a memorabilia reprint.
const SET_TYPE_RANK: Record<string, number> = { core: 0, expansion: 0, draft_innovation: 1, commander: 1, masters: 2, starter: 3 };

/**
 * The printing to open on: the best kind of set, then the regular print of it
 * (`regularFirst` in scan-core: plain number, nonfoil, newest, lowest number).
 * It used to rely on the input being newest-first and a stable sort, so
 * printings of one set tied and the winner was whichever the database returned
 * first (a foil-only showcase, ECL #385, for Bloodline Bidding).
 */
export function pickRepresentative(printings: CardPrinting[]): CardPrinting | null {
  return [...printings].sort((a, b) => (SET_TYPE_RANK[a.setType ?? ''] ?? 5) - (SET_TYPE_RANK[b.setType ?? ''] ?? 5) || regularFirst(a, b))[0] ?? null;
}

/** The scan-core shape the collection writer validates against. */
export function toPrinting(p: CardPrinting): Printing {
  return {
    id: p.id, oracleId: p.oracleId, name: p.name, aliases: [], setCode: p.setCode, collectorNumber: p.collectorNumber,
    finishes: p.finishes, language: p.language, imageUri: p.image ?? undefined, setName: p.setName,
    releasedAt: p.releasedAt ?? undefined, rarity: p.rarity,
  };
}

export type OwnedStack = {
  id: string; quantity: number; setCode: string; collectorNumber: string; finish: string; condition: string; locationName: string | null;
  /** The printing this stack is recorded against (card_instances.card_id, the Scryfall id) —
   *  the reprint picker's "what it currently is" half of the stack key. */
  cardId: string;
  language: string;
  /** null means Unsorted — a real value, not "no destination chosen"; see the fetchOwned callers. */
  locationId: string | null;
  /** "deck" flags a sleeved stack, for the "the deck's list keeps naming the printing it asks for" note. */
  locationType: string | null;
  /**
   * A card someone bothered to annotate never merges (packages/upkeep-domain's
   * stackKeyFor) — decideReprint needs the real value to make the same call
   * apply_stack_reprint's own re-verification makes, not "insert" by
   * accident or "merge" over a note that would then be lost.
   */
  notes: string | null;
};

/** The signed-in user's own copies of this card, across printings. */
export async function fetchOwned(userId: string, name: string): Promise<{ stacks: OwnedStack[]; error: string | null }> {
  if (!backend) return { stacks: [], error: null };
  let res;
  try {
    res = await bounded(backend
      .from('collection_entries')
      .select('id,quantity,card_id,card_set_code,card_collector_number,finish,condition,language,location_id,location_name,location_type,notes')
      .eq('owner_user_id', userId)
      .eq('card_name', name)
      .limit(200));
  } catch { return { stacks: [], error: LOAD_FAILED }; }
  const { data, error } = res;
  if (error) return { stacks: [], error: LOAD_FAILED };
  return {
    stacks: (data ?? []).map(r => ({
      id: r.id as string, quantity: r.quantity as number, setCode: r.card_set_code as string, collectorNumber: r.card_collector_number as string,
      finish: r.finish as string, condition: r.condition as string, locationName: (r.location_name as string | null) ?? null,
      cardId: r.card_id as string, language: r.language as string, locationId: (r.location_id as string | null) ?? null,
      locationType: (r.location_type as string | null) ?? null, notes: (r.notes as string | null) ?? null,
    })),
    error: null,
  };
}

/** Total wanted across printings of this card, for this user. */
export async function fetchWantedQuantity(userId: string, printingIds: string[]): Promise<number> {
  if (!backend || printingIds.length === 0) return 0;
  const { data } = await bounded(backend.from('want_list').select('quantity').eq('user_id', userId).in('card_id', printingIds));
  return (data ?? []).reduce((sum, r) => sum + (r.quantity as number), 0);
}

/** Adds one to the wish list for this printing; a repeat adds to the quantity,
 *  as on the web (one row per user and printing). */
export { addToWishList } from './wishlist';

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export type FriendActivity = {
  /** Friends with a copy of this card in a container they marked tradable. */
  haveForTrade: { userId: string; username: string; quantity: number; samePrinting: boolean }[];
  /** Friends with this card on their wish list. */
  want: { userId: string; username: string; quantity: number }[];
};

/**
 * Which friends have this card open for trade and which want it.
 *
 * Deliberately reads across people: RLS (migration 9) hands back a friend's
 * `card_instances` only when the copy sits in a container they marked
 * tradable, and a friend's `want_list` rows only to a friend -- nothing here
 * reaches anyone else's data. Both still exclude the caller explicitly, so
 * your own rows never show up as a "friend".
 *
 * Matches on every printing of the card's name (`printingIds`), so a friend
 * holding a different printing still counts, flagged as not the same one.
 */
export async function fetchFriendActivity(userId: string, printingIds: string[], selectedId: string | null): Promise<FriendActivity> {
  const empty: FriendActivity = { haveForTrade: [], want: [] };
  if (!backend || printingIds.length === 0) return empty;
  const [tradable, wants] = await bounded(Promise.all([
    backend.from('card_instances').select('owner_user_id,quantity,card_id').neq('owner_user_id', userId).in('card_id', printingIds).limit(500),
    backend.from('want_list').select('user_id,quantity').neq('user_id', userId).in('card_id', printingIds).limit(500),
  ]));
  const have = new Map<string, { quantity: number; samePrinting: boolean }>();
  for (const r of tradable.data ?? []) {
    const id = r.owner_user_id as string;
    const cur = have.get(id) ?? { quantity: 0, samePrinting: false };
    have.set(id, { quantity: cur.quantity + (r.quantity as number), samePrinting: cur.samePrinting || r.card_id === selectedId });
  }
  const want = new Map<string, number>();
  for (const r of wants.data ?? []) want.set(r.user_id as string, (want.get(r.user_id as string) ?? 0) + (r.quantity as number));

  const ids = [...new Set([...have.keys(), ...want.keys()])];
  if (ids.length === 0) return empty;
  const { data: profiles } = await bounded(backend.from('profiles').select('id,username').in('id', ids));
  const names = new Map((profiles ?? []).map(p => [p.id as string, p.username as string]));
  const name = (id: string) => names.get(id) ?? 'a friend';
  return {
    haveForTrade: [...have].map(([id, v]) => ({ userId: id, username: name(id), ...v })).sort((a, b) => a.username.localeCompare(b.username)),
    want: [...want].map(([id, quantity]) => ({ userId: id, username: name(id), quantity })).sort((a, b) => a.username.localeCompare(b.username)),
  };
}

// ---------------------------------------------------------------------------
// Legalities and rulings -- from Scryfall's own API, at the moment someone asks.
// The `cards` table carries neither, and adding them would mean a migration
// and a change to the nightly sync for something few people open. Scryfall's
// API is free, keyless and asks only for these two headers.
// ---------------------------------------------------------------------------

export const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl'] as const;
export type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted';
export type Ruling = { date: string; comment: string };
export type ScryfallExtras = { legalities: Partial<Record<(typeof FORMATS)[number], Legality>>; rulings: Ruling[] };

const SCRYFALL_HEADERS = { Accept: 'application/json', 'User-Agent': 'ProjectUpkeep/1.0 (mobile)' };

export async function fetchScryfallExtras(printingId: string): Promise<ScryfallExtras> {
  const base = `https://api.scryfall.com/cards/${printingId}`;
  const [cardRes, rulingsRes] = await bounded(Promise.all([fetch(base, { headers: SCRYFALL_HEADERS }), fetch(`${base}/rulings`, { headers: SCRYFALL_HEADERS })]));
  if (!cardRes.ok) throw new Error('Scryfall could not be reached.');
  const card = (await bounded(cardRes.json())) as { legalities?: Record<string, string> };
  const rulings = rulingsRes.ok ? ((await bounded(rulingsRes.json())) as { data?: { published_at: string; comment: string }[] }).data ?? [] : [];
  const legalities: ScryfallExtras['legalities'] = {};
  for (const f of FORMATS) {
    const v = card.legalities?.[f];
    if (v === 'legal' || v === 'not_legal' || v === 'banned' || v === 'restricted') legalities[f] = v;
  }
  return { legalities, rulings: rulings.map(r => ({ date: r.published_at, comment: r.comment })) };
}

// ---------------------------------------------------------------------------
// Wish list
// ---------------------------------------------------------------------------

export type WantEntry = {
  id: string; cardId: string; oracleId: string; quantity: number; name: string; setCode: string; collectorNumber: string; imageSmall: string | null; priceUsd: number | null;
  /** Layout of the printing, so the wish list row can offer a flip on a two-sided card. */
  layout: string | null;
};

export async function fetchWantList(userId: string): Promise<WantEntry[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('want_list')
    .select('id,card_id,quantity,cards(oracle_id,name,set_code,collector_number,image_uri_small,price_usd,layout)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(r => {
    const c = r.cards as unknown as { oracle_id: string; name: string; set_code: string; collector_number: string; image_uri_small: string | null; price_usd: number | string | null; layout: string | null } | null;
    return c ? [{ id: r.id as string, cardId: r.card_id as string, oracleId: c.oracle_id, quantity: r.quantity as number, name: c.name, setCode: c.set_code, collectorNumber: c.collector_number, imageSmall: c.image_uri_small, priceUsd: num(c.price_usd), layout: c.layout }] : [];
  });
}

export async function removeWant(userId: string, wantId: string): Promise<void> {
  if (!backend) return;
  const { error } = await backend.from('want_list').delete().eq('id', wantId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/** For each wanted card (by oracle id), how many friends have a copy open for
 *  trade. One query for the whole list; same cross-person read as above. */
export async function fetchFriendSupplyCounts(userId: string, oracleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!backend || oracleIds.length === 0) return out;
  const { data } = await backend
    .from('card_instances')
    .select('owner_user_id,cards!inner(oracle_id)')
    .neq('owner_user_id', userId)
    .in('cards.oracle_id', oracleIds)
    .limit(5000);
  const owners = new Map<string, Set<string>>();
  for (const r of data ?? []) {
    const oracle = (r.cards as unknown as { oracle_id: string }).oracle_id;
    if (!owners.has(oracle)) owners.set(oracle, new Set());
    owners.get(oracle)!.add(r.owner_user_id as string);
  }
  for (const [oracle, set] of owners) out.set(oracle, set.size);
  return out;
}
