import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Card, CardInstanceWithCard, Finish, Location, LocationNode } from "@/lib/types";
import {
  MAX_ROWS,
  UNSORTED,
  applyFilter,
  type CollectionFilter,
} from "@/lib/collection/filters";
import {
  cardKey,
  computeAvailability,
  takeableFrom,
  type Availability,
  type CountableRow,
} from "@/lib/collection/availability";
import { locateCards, MIN_TERM, type LocatableRow, type LocatedCard } from "@/lib/collection/locate";
import { summariseValue, type ValueSummary } from "@/lib/collection/pricing";
import {
  summariseBreakdown,
  type BreakdownRow,
  type CollectionBreakdown,
} from "@/lib/collection/breakdown";

/**
 * Read helpers for the signed-in user's collection.
 *
 * Every query here runs as the user through RLS, so none of them filter by
 * user id themselves — the database does it. Adding a redundant `.eq('owner_
 * user_id', ...)` would only create a second place to get it wrong.
 */

// Re-exported so pages can keep importing the sentinel from one place.
export { UNSORTED };

/**
 * The card columns the collection view needs.
 *
 * Includes the detail columns, because the filter matches on rules text,
 * colours and printed stats. That breadth is the cost of filtering in
 * application code — see the note at the top of src/lib/collection/filters.ts
 * for why the rules live in one place rather than half in PostgREST.
 */
const CARD_FIELDS = `cards ( scryfall_id, oracle_id, name, set_code, set_name,
           collector_number, rarity, type_line, released_at, image_uri,
           image_uri_small, scryfall_uri, available_finishes, lang, digital,
           last_synced_at, mana_cost, cmc, colors, color_identity, oracle_text,
           flavor_text, keywords, power, toughness, loyalty, artist, layout,
           card_faces, set_type, price_usd, price_usd_foil, price_usd_etched,
           price_eur, price_eur_foil, tcgplayer_id, purchase_uri,
           prices_updated_at )`;

const INSTANCE_FIELDS = `id, owner_user_id, card_id, location_id, condition,
   finish, language, quantity, notes, acquired_at, created_at, updated_at`;

export type CollectionResult = {
  rows: CardInstanceWithCard[];
  /** Rows before filtering, so the UI can say "12 of 940". */
  total: number;
  /** True when the collection exceeds what we will filter in memory. */
  truncated: boolean;
};

/**
 * The signed-in user's collection, filtered.
 *
 * Location is pushed into the query: it is a plain column on card_instances,
 * it is the most selective thing most people pick, and doing it here keeps the
 * payload down. Every other criterion runs through `matchesFilter`, so the
 * awkward rules — colour modes, mana costs, printed stats that are not numbers
 * — exist in exactly one tested place.
 */
export async function getCollection(filter: CollectionFilter): Promise<CollectionResult> {
  const supabase = await createClient();

  let query = supabase
    .from("card_instances")
    .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type )`)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  // `location_id is null` and `location_id = x` are different operators, and
  // "unsorted" is a real value here, not a missing one.
  if (filter.location === UNSORTED) {
    query = query.is("location_id", null);
  } else if (filter.location) {
    query = query.eq("location_id", filter.location);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load collection: ${error.message}`);

  const rows = (data ?? []) as unknown as CardInstanceWithCard[];

  return {
    rows: applyFilter(rows, filter),
    total: rows.length,
    truncated: rows.length >= MAX_ROWS,
  };
}

/** Distinct sets present in the collection, for the set dropdown. */
export async function getCollectionSets(): Promise<Array<{ code: string; name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select("cards ( set_code, set_name )")
    .limit(MAX_ROWS);

  if (error) throw new Error(`Could not load sets: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    cards: { set_code: string; set_name: string | null } | null;
  }>;

  const byCode = new Map<string, string>();
  for (const row of rows) {
    if (!row.cards) continue;
    byCode.set(row.cards.set_code, row.cards.set_name ?? row.cards.set_code.toUpperCase());
  }

  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}


export async function getLocations(): Promise<Location[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load locations: ${error.message}`);
  return (data ?? []) as Location[];
}

/** The instance columns the counting below needs, and nothing more. */
type CountableInstance = { location_id: string | null; quantity: number };

/**
 * Arranges locations into parents-with-children and tallies what sits in each.
 *
 * Pure, and shared by the locations page and the dashboard so the two can never
 * disagree about what "how many cards are in this binder" means.
 *
 * Counts physical cards, not rows: a stack of 12 should read as 12.
 */
function summarise(all: Location[], instances: CountableInstance[]) {
  const counts = new Map<string, number>();
  let unsortedCount = 0;
  let totalCards = 0;

  for (const { location_id, quantity } of instances) {
    totalCards += quantity;
    if (location_id === null) {
      unsortedCount += quantity;
    } else {
      counts.set(location_id, (counts.get(location_id) ?? 0) + quantity);
    }
  }

  const byParent = new Map<string, Location[]>();
  for (const loc of all) {
    if (loc.parent_location_id) {
      const siblings = byParent.get(loc.parent_location_id) ?? [];
      siblings.push(loc);
      byParent.set(loc.parent_location_id, siblings);
    }
  }

  const tree: LocationNode[] = all
    .filter((l) => l.parent_location_id === null)
    .map((l) => ({
      ...l,
      children: byParent.get(l.id) ?? [],
      instance_count: counts.get(l.id) ?? 0,
    }));

  return {
    tree,
    unsortedCount,
    totalCards,
    /** Rows, not cards — the number of distinct stacks. */
    totalEntries: instances.length,
    countFor: (id: string) => counts.get(id) ?? 0,
  };
}

/**
 * Locations arranged as parents with their children, plus how many instances
 * sit directly in each. Counting here rather than per-row in the UI keeps the
 * locations page to two queries regardless of how many locations exist.
 */
export async function getLocationTree(): Promise<{
  tree: LocationNode[];
  unsortedCount: number;
}> {
  const supabase = await createClient();

  const [{ data: locations, error: locError }, { data: instances, error: instError }] =
    await Promise.all([
      supabase.from("locations").select("*").order("name", { ascending: true }),
      supabase.from("card_instances").select("location_id, quantity"),
    ]);

  if (locError) throw new Error(`Could not load locations: ${locError.message}`);
  if (instError) throw new Error(`Could not load collection: ${instError.message}`);

  const { tree, unsortedCount } = summarise(
    (locations ?? []) as Location[],
    (instances ?? []) as CountableInstance[],
  );

  return { tree, unsortedCount };
}

export type DashboardSummary = {
  /** What the collection is worth, and what it could not price. */
  value: ValueSummary;
  totalCards: number;
  totalEntries: number;
  locationCount: number;
  unsortedCount: number;
  /** Top-level containers with their direct card counts, biggest first. */
  locations: LocationNode[];
  /** Most recently added stacks, newest first. */
  recent: CardInstanceWithCard[];
  /** The collection split by colour and by set. */
  breakdown: CollectionBreakdown;
};

/**
 * Everything the dashboard renders, in four queries.
 *
 * Deliberately one function rather than the page calling several helpers: the
 * numbers on that page are read together and should come from a single
 * consistent snapshot.
 *
 * Valuing the collection needs the price of every row, which the counting query
 * does not carry, so it is its own narrow read rather than a widening of that
 * one — the counts are needed on every load, the prices only to total them.
 */
export async function getDashboardSummary(
  recentLimit = 6,
): Promise<DashboardSummary> {
  const supabase = await createClient();

  const [
    { data: locations, error: locError },
    { data: instances, error: instError },
    { data: priceable, error: priceError },
    { data: shape, error: shapeError },
    { data: recent, error: recentError },
  ] = await Promise.all([
    supabase.from("locations").select("*").order("name", { ascending: true }),
    supabase.from("card_instances").select("location_id, quantity"),
    supabase
      .from("card_instances")
      .select("quantity, finish, cards ( name, price_usd, price_usd_foil, price_usd_etched )")
      .limit(MAX_ROWS),
    supabase
      .from("card_instances")
      .select("quantity, cards ( colors, set_code, set_name )")
      .limit(MAX_ROWS),
    supabase
      .from("card_instances")
      // The shared field lists rather than a shorter bespoke one: these rows
      // feed the card panel on hover, and the panel can only be instant if the
      // row already carries every column it renders.
      .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type )`)
      .order("created_at", { ascending: false })
      .limit(recentLimit),
  ]);

  if (locError) throw new Error(`Could not load locations: ${locError.message}`);
  if (instError) throw new Error(`Could not load collection: ${instError.message}`);
  // A pricing failure must not take the dashboard down with it: prices are a
  // nice-to-have on this page, the counts are not.
  if (priceError) console.error("Could not value the collection:", priceError.message);
  // The breakdown is decoration, like the value — a failed read leaves it empty
  // rather than taking the page down.
  if (shapeError) console.error("Could not break the collection down:", shapeError.message);
  if (recentError) {
    throw new Error(`Could not load recent additions: ${recentError.message}`);
  }

  const all = (locations ?? []) as Location[];
  const summary = summarise(all, (instances ?? []) as CountableInstance[]);

  // Busiest containers first: on a dashboard the empty ones are the least
  // interesting thing to lead with.
  const ranked = [...summary.tree].sort((a, b) => {
    const aTotal = a.instance_count + a.children.reduce((s, c) => s + summary.countFor(c.id), 0);
    const bTotal = b.instance_count + b.children.reduce((s, c) => s + summary.countFor(c.id), 0);
    return bTotal - aTotal;
  });

  return {
    value: summariseValue((priceable ?? []) as unknown as CardInstanceWithCard[]),
    totalCards: summary.totalCards,
    totalEntries: summary.totalEntries,
    locationCount: all.length,
    unsortedCount: summary.unsortedCount,
    locations: ranked,
    recent: (recent ?? []) as unknown as CardInstanceWithCard[],
    breakdown: summariseBreakdown((shape ?? []) as unknown as BreakdownRow[]),
  };
}

// ---------------------------------------------------------------------------
// Decks and availability
// ---------------------------------------------------------------------------

/**
 * Availability across the whole collection.
 *
 * Deliberately unfiltered. "3 of your 4 are in decks" has to be true of
 * everything you own, not of whatever the current filter happens to show, so
 * this runs its own narrow query rather than reusing the filtered rows.
 */
export async function getAvailability(): Promise<Map<string, Availability>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select("quantity, cards ( oracle_id, name ), locations!location_id ( type )")
    .limit(MAX_ROWS);

  if (error) throw new Error(`Could not work out availability: ${error.message}`);

  return computeAvailability((data ?? []) as unknown as CountableRow[]);
}

/**
 * For every card, the containers its spare copies sit in.
 *
 * "Spare" means not already sleeved in a deck — the same rule availability
 * uses. Keyed on oracle id so a deck line for Lightning Bolt finds any
 * Lightning Bolt. Feeds the "in Box 3" tag on a deck's available rows: knowing
 * a copy is free is only half the answer, the other half is which binder.
 */
export async function getSpareLocations(): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select("cards ( oracle_id, name ), locations!location_id ( name, type )")
    .limit(MAX_ROWS);

  if (error) throw new Error(`Could not locate spare copies: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    cards: { oracle_id: string | null; name: string } | null;
    locations: { name: string; type: string } | null;
  }>;

  const byCard = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.locations?.type === "deck") continue; // sleeved somewhere already
    const key = cardKey(row.cards);
    if (!key) continue;
    const name = row.locations?.name ?? "Unsorted";
    const set = byCard.get(key) ?? new Set<string>();
    set.add(name);
    byCard.set(key, set);
  }

  return new Map(
    [...byCard.entries()].map(([key, names]) => [
      key,
      [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ]),
  );
}

/**
 * Where every copy of the cards matching `term` physically lives.
 *
 * The whole "does my inventory match reality" premise, made answerable in one
 * box: type a name, see which binder, box or deck each copy is in. Runs its own
 * narrow query — image and location, nothing else — and groups in memory, the
 * same trade the rest of this file makes for a collection that is thousands of
 * rows, not millions.
 */
export async function locateInCollection(term: string): Promise<LocatedCard[]> {
  if (term.trim().length < MIN_TERM) return [];

  const supabase = await createClient();

  /**
   * Narrow in the database before grouping in memory.
   *
   * The matching rule is "every word appears somewhere in the name", which one
   * SQL predicate cannot express — but the *longest* word is a necessary
   * condition for a match and the most selective single term available, so it
   * makes a sound pre-filter. `locateCards` still applies the full rule to what
   * comes back, so the result is identical to scanning everything; this only
   * decides how much travels.
   *
   * That matters because this now runs on every keystroke in the header search,
   * not just on a page load.
   */
  const probe = term
    .trim()
    .split(/\s+/)
    // Anything PostgREST would read as filter syntax is dropped rather than
    // escaped: it is a pre-filter, and a slightly wider net is harmless.
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .reduce((longest, word) => (word.length > longest.length ? word : longest), "");

  let query = supabase
    .from("card_instances")
    .select(
      // !inner so the filter on the joined card actually excludes rows rather
      // than merely nulling the embedded object.
      "quantity, card_id, cards!inner ( oracle_id, name, image_uri_small ), locations!location_id ( id, name, type )",
    )
    .limit(MAX_ROWS);

  if (probe.length >= MIN_TERM) query = query.ilike("cards.name", `%${probe}%`);

  const { data, error } = await query;

  if (error) throw new Error(`Could not search your collection: ${error.message}`);

  // card_id lives on the instance; fold it into the card shape locateCards reads.
  const rows: LocatableRow[] = ((data ?? []) as unknown as Array<{
    quantity: number;
    card_id: string | null;
    cards: { oracle_id: string | null; name: string; image_uri_small: string | null } | null;
    locations: { id: string; name: string; type: Location["type"] } | null;
  }>).map((r) => ({
    quantity: r.quantity,
    cards: r.cards ? { ...r.cards, card_id: r.card_id } : null,
    locations: r.locations,
  }));

  return locateCards(rows, term);
}

export type DeckSummary = Location & {
  /** Total cards the decklist asks for (sum of deck_cards.quantity). */
  cardCount: number;
  /** Distinct card names on the list. */
  uniqueCount: number;
  /** The nominated commander's name, if one is set. */
  commanderName: string | null;
};

/**
 * Every deck, with its list size and commander.
 *
 * The size is the decklist (deck_cards), not what is physically sleeved — a
 * freshly imported list has 0 cards in the box but is not an empty deck.
 */
export async function getDecks(): Promise<DeckSummary[]> {
  const supabase = await createClient();

  const [{ data: decks, error: deckError }, { data: deckCards, error: dcError }] =
    await Promise.all([
      supabase.from("locations").select("*").eq("type", "deck").order("name"),
      supabase.from("deck_cards").select("deck_id, quantity, cards ( name )").limit(MAX_ROWS),
    ]);

  if (deckError) throw new Error(`Could not load decks: ${deckError.message}`);
  if (dcError) throw new Error(`Could not load decklists: ${dcError.message}`);

  const totalByDeck = new Map<string, number>();
  const namesByDeck = new Map<string, Set<string>>();
  for (const raw of (deckCards ?? []) as unknown as Array<{
    deck_id: string;
    quantity: number;
    cards: { name: string } | null;
  }>) {
    totalByDeck.set(raw.deck_id, (totalByDeck.get(raw.deck_id) ?? 0) + raw.quantity);
    if (raw.cards?.name) {
      const set = namesByDeck.get(raw.deck_id) ?? new Set<string>();
      set.add(raw.cards.name.toLowerCase());
      namesByDeck.set(raw.deck_id, set);
    }
  }

  const deckRows = (decks ?? []) as Location[];

  // Commander names in one lookup, not one per deck.
  const commanderIds = [
    ...new Set(deckRows.map((d) => d.commander_card_id).filter((v): v is string => !!v)),
  ];
  const commanderNames = new Map<string, string>();
  if (commanderIds.length > 0) {
    const { data: cmdCards } = await supabase
      .from("cards")
      .select("scryfall_id, name")
      .in("scryfall_id", commanderIds);
    for (const c of (cmdCards ?? []) as Array<{ scryfall_id: string; name: string }>) {
      commanderNames.set(c.scryfall_id, c.name);
    }
  }

  return deckRows.map((deck) => ({
    ...deck,
    cardCount: totalByDeck.get(deck.id) ?? 0,
    uniqueCount: namesByDeck.get(deck.id)?.size ?? 0,
    commanderName: deck.commander_card_id
      ? (commanderNames.get(deck.commander_card_id) ?? null)
      : null,
  }));
}

/** One deck, or null when the id is not a deck this user owns. */
export async function getDeck(deckId: string): Promise<Location | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("id", deckId)
    .eq("type", "deck")
    .maybeSingle();

  if (error) throw new Error(`Could not load deck: ${error.message}`);
  return (data as Location | null) ?? null;
}

/** The cards sleeved into one deck. */
export async function getDeckContents(deckId: string): Promise<CardInstanceWithCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type )`)
    .eq("location_id", deckId)
    .limit(MAX_ROWS);

  if (error) throw new Error(`Could not load deck contents: ${error.message}`);
  return (data ?? []) as unknown as CardInstanceWithCard[];
}

/**
 * Stacks that could be moved into a deck, for the "add from collection" picker.
 *
 * Only stacks outside a deck are returned: taking a card out of one deck to put
 * it in another is a real thing to want, but it is a transfer rather than an
 * addition, and it should be asked for deliberately.
 */
export async function getAvailableStacks(search: string): Promise<CardInstanceWithCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type )`)
    .limit(MAX_ROWS);

  if (error) throw new Error(`Could not load your collection: ${error.message}`);

  const rows = (data ?? []) as unknown as CardInstanceWithCard[];
  const needle = search.trim().toLowerCase();

  return rows
    .filter((row) => takeableFrom(row) > 0)
    .filter((row) => (needle ? (row.cards?.name ?? "").toLowerCase().includes(needle) : true))
    .sort((a, b) => (a.cards?.name ?? "").localeCompare(b.cards?.name ?? ""));
}

// ---------------------------------------------------------------------------
// Decklists
// ---------------------------------------------------------------------------

export type DeckListEntry = {
  id: string;
  deck_id: string;
  card_id: string;
  quantity: number;
  /**
   * Named `cards`, not `card`, so an entry groups and sorts through the same
   * helpers the physical rows use. See GroupableRow in deck-view.ts.
   */
  cards: Card | null;
  /** Copies of this card physically in this deck, across every printing. */
  sleeved: number;
  /**
   * The distinct finishes of those sleeved copies. A list entry has no finish
   * of its own — it names a card, not a copy — so this is the only place the
   * page can learn that the Sol Ring in this deck is the foil one.
   */
  sleevedFinishes: Finish[];
};

/**
 * A deck's intended list, with how much of it is actually sleeved.
 *
 * Sleeved counts are matched on oracle id rather than on the printing named by
 * the entry: a list asking for Lightning Bolt is satisfied by any Lightning
 * Bolt, which is also how availability is counted everywhere else.
 */
export async function getDeckList(deckId: string): Promise<DeckListEntry[]> {
  const supabase = await createClient();

  const [{ data: entries, error: entryError }, contents] = await Promise.all([
    supabase
      .from("deck_cards")
      .select(`id, deck_id, card_id, quantity, ${CARD_FIELDS}`)
      .eq("deck_id", deckId)
      .limit(MAX_ROWS),
    getDeckContents(deckId),
  ]);

  if (entryError) throw new Error(`Could not load the decklist: ${entryError.message}`);

  // Physically-sleeved copies, keyed the same way availability is: count, and
  // the set of finishes among them.
  const sleevedByCard = new Map<string, number>();
  const finishesByCard = new Map<string, Set<Finish>>();
  for (const row of contents) {
    const key = cardKey(row.cards);
    if (!key) continue;
    sleevedByCard.set(key, (sleevedByCard.get(key) ?? 0) + row.quantity);
    const set = finishesByCard.get(key) ?? new Set<Finish>();
    set.add(row.finish as Finish);
    finishesByCard.set(key, set);
  }

  const rows = (entries ?? []) as unknown as Array<{
    id: string;
    deck_id: string;
    card_id: string;
    quantity: number;
    cards: Card | null;
  }>;

  return rows.map((row) => {
    const key = cardKey(row.cards) ?? "";
    return {
      id: row.id,
      deck_id: row.deck_id,
      card_id: row.card_id,
      quantity: row.quantity,
      cards: row.cards,
      sleeved: sleevedByCard.get(key) ?? 0,
      sleevedFinishes: [...(finishesByCard.get(key) ?? [])],
    };
  });
}

/**
 * Cards physically in this deck that the list does not mention.
 *
 * Should be rare — sleeving adds a list entry — but a card moved in from the
 * collection page, or a list entry deleted while its cards stayed put, would
 * otherwise vanish from view while still being in the box.
 */
export function strandedInDeck(
  contents: CardInstanceWithCard[],
  entries: DeckListEntry[],
): CardInstanceWithCard[] {
  const listed = new Set(entries.map((e) => cardKey(e.cards)).filter(Boolean));
  return contents.filter((row) => !listed.has(cardKey(row.cards) ?? ""));
}

// ---------------------------------------------------------------------------
// Deck wish list
// ---------------------------------------------------------------------------

/**
 * One want-list entry tagged to this deck (migration 17).
 *
 * Shaped to satisfy `GroupableRow` (id, quantity, cards) so the deck page can
 * group it into the same Creatures/Lands/etc. sections as the decklist itself
 * through `groupDeck` — see src/lib/collection/deck-view.ts — rather than
 * inventing a second grouping rule for what is, on screen, a second list.
 */
export type WishListEntry = {
  id: string;
  card_id: string;
  quantity: number;
  cards: Card | null;
  note: string | null;
};

/**
 * The subset of the signed-in user's want list tagged to one deck.
 *
 * Not filtered by user id for the usual reason (RLS does that), but there is
 * a second reason it is safe to skip here specifically: migration 17's
 * enforce_want_deck_owner trigger means a row can only carry this deck_id if
 * its user_id already matches the deck's owner, so nothing but this user's
 * own rows can ever match `.eq("deck_id", deckId)`.
 */
export async function getDeckWishList(deckId: string): Promise<WishListEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .select(`id, card_id, quantity, note, ${CARD_FIELDS}`)
    .eq("deck_id", deckId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    // PGRST205: want_list itself is not migrated in yet (migration 15).
    // 42703: deck_id specifically is missing (migration 17 not applied yet).
    // Either way, an empty wish list is the honest answer, not a broken page.
    if (error.code === "PGRST205" || error.code === "42703") return [];
    throw new Error(`Could not load the deck's wish list: ${error.message}`);
  }

  return (data ?? []) as unknown as WishListEntry[];
}
