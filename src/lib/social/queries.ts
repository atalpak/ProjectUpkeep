import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { cardDisplayName, type Card, type CardInstanceWithCard } from "@/lib/types";
import type {
  FeedEntry,
  FriendEdge,
  Friendship,
  Notification,
  NotificationDetail,
  Profile,
  Trade,
  TradeDetail,
  TradeItem,
} from "@/lib/social/types";
import type { TosStatus } from "@/lib/social/tos";
import type { WantExportRow } from "@/lib/social/want-export";
import { expiringSoon, isExpired } from "@/lib/social/trade-status";
import { cardKey } from "@/lib/collection/availability";
import { MIN_TERM } from "@/lib/collection/locate";
import { displayPrice } from "@/lib/collection/pricing";
import {
  matchFriendCardStock,
  matchTradablesByTerm,
  matchWants,
  type FriendCardMatch,
  type FriendPrintingSupplier,
  type NamedTradableRow,
  type TradableRow,
  type WantRow,
  type WantSupplier,
} from "@/lib/social/wants";

/**
 * Reads for the social half of the app.
 *
 * Every query here runs as the signed-in user, so what comes back is already
 * bounded by the policies in migration 9 — a friend's tradable binder is
 * visible, everything else about them is not. None of these functions filter by
 * "am I allowed to see this"; the database does, which is the only place it can
 * be trusted.
 */

/** The card columns, as a bare list for a direct `from("cards")` select. */
const CARD_COLUMNS = `scryfall_id, oracle_id, name, flavor_name, set_code, set_name,
           collector_number, rarity, type_line, released_at, image_uri,
           image_uri_small, scryfall_uri, available_finishes, lang, digital,
           last_synced_at, mana_cost, cmc, colors, color_identity, oracle_text,
           flavor_text, keywords, power, toughness, loyalty, artist, layout,
           card_faces, set_type, price_usd, price_usd_foil, price_usd_etched,
           price_eur, price_eur_foil, tcgplayer_id, purchase_uri,
           prices_updated_at`;

/** The same columns as an embedded relation, for `card_instances` joins. */
const CARD_FIELDS = `cards ( ${CARD_COLUMNS} )`;

const INSTANCE_FIELDS = `id, owner_user_id, card_id, location_id, condition,
   finish, language, quantity, notes, acquired_at, created_at, updated_at`;

/** Profiles by id, for putting names to the ids on trades and friendships. */
async function profilesByIds(ids: string[]): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, created_at")
    .in("id", unique);

  return new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

/** Accepted friends and outstanding requests, from your side. */
export async function getFriendEdges(): Promise<{
  friends: FriendEdge[];
  incoming: FriendEdge[];
  outgoing: FriendEdge[];
}> {
  const user = await getCurrentUser();
  if (!user) return { friends: [], incoming: [], outgoing: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("friendships")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load friends: ${error.message}`);

  const rows = (data ?? []) as Friendship[];
  const others = rows.map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id));
  const profiles = await profilesByIds(others);

  const edges: FriendEdge[] = rows.map((friendship) => {
    const otherId =
      friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id;
    return {
      friendship,
      profile: profiles.get(otherId) ?? {
        id: otherId,
        username: "unknown",
        created_at: friendship.created_at,
      },
      direction: friendship.requester_id === user.id ? "outgoing" : "incoming",
    };
  });

  return {
    friends: edges.filter((e) => e.friendship.status === "accepted"),
    incoming: edges.filter((e) => e.friendship.status === "pending" && e.direction === "incoming"),
    outgoing: edges.filter((e) => e.friendship.status === "pending" && e.direction === "outgoing"),
  };
}

/**
 * Finds people by username.
 *
 * Profiles are readable by any signed-in user — that is what makes a friend
 * request possible at all — but a profile holds only a username, so this
 * exposes nothing beyond the handle someone chose to be known by.
 */
export async function searchProfiles(query: string, limit = 10): Promise<Profile[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, created_at")
    .ilike("username", `%${term}%`)
    .limit(limit);

  if (error) throw new Error(`Could not search for people: ${error.message}`);

  // Finding yourself in the results is only ever noise.
  return ((data ?? []) as Profile[]).filter((p) => p.id !== user?.id);
}

/**
 * Whether the signed-in user has accepted the trading terms, and which version.
 *
 * Written to tolerate migration 00000000000012 not being applied yet: if the
 * columns are missing the query errors, and this returns null rather than
 * throwing. Callers treat "cannot tell" as "do not block" — the enforcement in
 * the trade actions does the same — so the app keeps working until the
 * migration lands, at which point the gate starts to bite.
 */
export async function getMyTosStatus(): Promise<TosStatus | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("tos_accepted_at, tos_version")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (!/column .*tos_/.test(error.message)) {
      console.error("Could not read terms acceptance:", error.message);
    }
    return null;
  }

  return {
    accepted_at: (data?.tos_accepted_at as string | null) ?? null,
    version: (data?.tos_version as string | null) ?? null,
  };
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, created_at")
    .ilike("username", username)
    .maybeSingle();

  if (error) throw new Error(`Could not load that profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

// ---------------------------------------------------------------------------
// Someone else's tradables
// ---------------------------------------------------------------------------

/**
 * The cards another person has marked as tradable.
 *
 * Returns nothing at all unless the policies allow it — you are friends and the
 * cards sit in a location they flagged. There is no "are we friends" check in
 * this function on purpose: duplicating the rule in application code would
 * create a second place for it to be wrong.
 *
 * Deliberately does not join `locations` — a friend agreeing to show what they
 * have open for trade is not the same as agreeing to show which binder or box
 * it is sitting in. `CardInstanceWithCard.locations` comes back `undefined`
 * here, which every caller already treats the same as `null`.
 */
export async function getTradableCards(ownerId: string): Promise<CardInstanceWithCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}`)
    .eq("owner_user_id", ownerId)
    .limit(5000);

  if (error) throw new Error(`Could not load their trade binder: ${error.message}`);
  return (data ?? []) as unknown as CardInstanceWithCard[];
}

/** Your own cards that are currently offerable, for building a proposal. */
export async function getMyTradableCards(): Promise<CardInstanceWithCard[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type, is_tradable )`)
    .eq("owner_user_id", user.id)
    .limit(5000);

  if (error) throw new Error(`Could not load your trade binder: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<
    CardInstanceWithCard & { locations: { is_tradable?: boolean } | null }
  >;
  return rows.filter((r) => r.locations?.is_tradable === true);
}

// ---------------------------------------------------------------------------
// Want list
// ---------------------------------------------------------------------------

const WANT_CARD_FIELDS =
  "cards ( scryfall_id, oracle_id, name, flavor_name, set_name, set_code, image_uri_small, price_usd, price_usd_foil, price_usd_etched )";

type RawWant = {
  id: string;
  card_id: string;
  quantity: number;
  note: string | null;
  cards: {
    scryfall_id: string;
    oracle_id: string | null;
    name: string;
    flavor_name: string | null;
    set_name: string | null;
    set_code: string;
    image_uri_small: string | null;
    price_usd: number | null;
    price_usd_foil: number | null;
    price_usd_etched: number | null;
  } | null;
};

/**
 * A want row with its deck tag joined in (migration 17) — own list only.
 *
 * `getFriendWants` deliberately keeps selecting the plain `RawWant` shape
 * above, without this join, so a friend's payload never carries deck_id or a
 * deck name no matter what RLS on `locations` would have allowed through. See
 * migration 17's closing comment for why that matters even though the
 * friends'-tradable-locations policy (migration 9) makes it not quite free at
 * the database layer.
 */
type RawOwnWant = RawWant & {
  deck_id: string | null;
  locations: { id: string; name: string } | null;
};

function toWantRow(raw: RawWant): WantRow {
  return {
    id: raw.id,
    key: cardKey(raw.cards) ?? `id:${raw.card_id}`,
    name: raw.cards?.name ?? "Unknown card",
    displayName: raw.cards ? cardDisplayName(raw.cards) : "Unknown card",
    cardId: raw.cards?.scryfall_id ?? raw.card_id,
    image: raw.cards?.image_uri_small ?? null,
    price: raw.cards ? displayPrice(raw.cards, "nonfoil") : null,
    quantity: raw.quantity,
    note: raw.note,
  };
}

function toOwnWantRow(raw: RawOwnWant): WantRow {
  return {
    ...toWantRow(raw),
    deckId: raw.deck_id,
    deckName: raw.locations?.name ?? null,
  };
}

/** The signed-in user's want list, each entry carrying its deck tag if any. */
export async function getWantList(): Promise<WantRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .select(`id, card_id, quantity, note, deck_id, locations!deck_id ( id, name ), ${WANT_CARD_FIELDS}`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "PGRST205") return []; // table not created yet
    // deck_id/locations!deck_id do not exist until migration 17 is applied.
    // Fall back to the plain shape rather than breaking the page over a tag
    // that simply is not there yet.
    if (error.message.includes("deck_id") || error.message.includes("locations")) {
      return getWantListWithoutDeckTag(user.id);
    }
    throw new Error(`Could not load your wish list: ${error.message}`);
  }

  return ((data ?? []) as unknown as RawOwnWant[]).map(toOwnWantRow);
}

async function getWantListWithoutDeckTag(userId: string): Promise<WantRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .select(`id, card_id, quantity, note, ${WANT_CARD_FIELDS}`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load your wish list: ${error.message}`);
  return ((data ?? []) as unknown as RawWant[]).map(toWantRow);
}

/**
 * The signed-in user's want list, shaped for export.
 *
 * `getWantList` above joins just enough of `cards` to render a row on screen
 * (name, flavor name, image) — export additionally needs `collector_number`,
 * which nothing else on this page uses, so this is its own query rather than
 * widening `WANT_CARD_FIELDS` for every reader of the wish list.
 */
export async function getWantExportRows(): Promise<WantExportRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .select("quantity, cards ( name, set_code, collector_number )")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(`Could not load your wish list: ${error.message}`);
  }

  return ((data ?? []) as unknown as Array<{
    quantity: number;
    cards: { name: string; set_code: string | null; collector_number: string | null } | null;
  }>).map((row) => ({
    name: row.cards?.name ?? "Unknown card",
    setCode: row.cards?.set_code ?? null,
    collectorNumber: row.cards?.collector_number ?? null,
    quantity: row.quantity,
  }));
}

/** A friend's want list — readable because you are friends (migration 15 policy). */
export async function getFriendWants(friendId: string): Promise<WantRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("want_list")
    .select(`id, card_id, quantity, note, ${WANT_CARD_FIELDS}`)
    .eq("user_id", friendId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(`Could not load their wish list: ${error.message}`);
  }

  return ((data ?? []) as unknown as RawWant[]).map(toWantRow);
}

/**
 * Every card a friend has open for trade, flattened for want-matching.
 *
 * RLS returns only rows in a friend's tradable container, so the `neq` on
 * owner is the only filter this needs — "not mine, and visible" is exactly a
 * friend's trade binder.
 *
 * Carries the card's name and flavor name, not just its key, so the same read
 * also backs `matchFriendTradablesByTerm` below — a free-text search has no
 * key to match on until a name match finds one.
 *
 * `locationName` always comes back `null` here — deliberately not joined.
 * Which binder or box a friend's copy sits in is not part of what marking a
 * container tradable shares; every caller of `matchWants` /
 * `matchTradablesByTerm` shows "who has it," never "where," for a friend's
 * supply. `getMyTradablesForMatching` below is the same shape for *your own*
 * cards, where showing the location is exactly the point.
 */
export async function getFriendTradables(): Promise<NamedTradableRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_instances")
    .select("owner_user_id, quantity, cards ( scryfall_id, oracle_id, name, flavor_name )")
    .neq("owner_user_id", user.id)
    .limit(5000);

  if (error) throw new Error(`Could not load friends' trade binders: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    owner_user_id: string;
    quantity: number;
    cards: {
      scryfall_id: string;
      oracle_id: string | null;
      name: string;
      flavor_name: string | null;
    } | null;
  }>).map((r) => ({
    ownerId: r.owner_user_id,
    key: cardKey(r.cards) ?? "",
    cardId: r.cards?.scryfall_id ?? null,
    quantity: r.quantity,
    locationName: null,
    name: r.cards?.name ?? "",
    flavorName: r.cards?.flavor_name ?? null,
  }));
}

/**
 * Which friends have a specific card open for trade, and whether their copy
 * is this printing or a different one — the card popup's "Friends have this"
 * line.
 *
 * Reuses `getFriendTradables()` rather than a query scoped to one card: the
 * popup opens over any card, so a per-card round trip would just be a smaller
 * version of the same friend-plus-tradable-container read that already backs
 * the want list and /find's cross-friend search. See that function's comment
 * for why this is a safe cross-person read — RLS (migration 9) never returns
 * a friend's row unless it sits in a container they marked tradable.
 */
export async function getFriendCardSuppliers(
  cardId: string,
  key: string,
): Promise<{ suppliers: FriendPrintingSupplier[]; profiles: Map<string, Profile> }> {
  const tradables = await getFriendTradables();
  const suppliers = matchFriendCardStock(cardId, key, tradables);
  const profiles = await profilesByIds(suppliers.map((s) => s.ownerId));
  return { suppliers, profiles };
}

/** My own tradables, flattened — for "this friend wants something you have". */
export async function getMyTradablesForMatching(): Promise<TradableRow[]> {
  const mine = await getMyTradableCards();
  return mine.map((r) => ({
    ownerId: r.owner_user_id,
    key: cardKey(r.cards) ?? "",
    quantity: r.quantity,
    locationName: r.locations?.name ?? null,
  }));
}

export type WantListView = {
  wants: WantRow[];
  /** want-row id -> who can supply it. */
  matches: Map<string, WantSupplier[]>;
  /** Every supplier profile referenced by `matches`, by user id. */
  suppliers: Map<string, Profile>;
};

/**
 * Who can supply an arbitrary set of want rows, plus their profiles.
 *
 * Factored out of `getWantListView` so a page that only cares about a subset
 * of the want list — the deck page's wish list, tagged to one deck — can get
 * the same friend-matching without loading (or paying the query cost of) the
 * whole thing. An empty input skips the friend-tradables query entirely: it
 * is the one query here with no `.eq` to narrow it, so there is no reason to
 * run it for a deck with nothing tagged.
 */
export async function matchSuppliersFor(
  wants: WantRow[],
): Promise<{ matches: Map<string, WantSupplier[]>; suppliers: Map<string, Profile> }> {
  if (wants.length === 0) return { matches: new Map(), suppliers: new Map() };

  const tradables = await getFriendTradables();
  const matches = matchWants(wants, tradables);

  const supplierIds = new Set<string>();
  for (const suppliers of matches.values()) {
    for (const s of suppliers) supplierIds.add(s.ownerId);
  }
  const suppliers = await profilesByIds([...supplierIds]);

  return { matches, suppliers };
}

/**
 * Who among your friends has *this* card open for trade — for a card you are
 * looking at but have not committed to wanting yet.
 *
 * The wish list's own matching (`getWantListView` / `matchSuppliersFor`) needs
 * a saved `want_list` row to key off. The add flow wants the same answer for a
 * card sitting in a draft row on screen, so this builds one synthetic
 * `WantRow` — everything but `key` is unused by `matchWants` — rather than
 * teaching that function a second calling convention.
 */
export async function matchSuppliersForCard(
  key: string,
): Promise<{ suppliers: WantSupplier[]; profiles: Map<string, Profile> }> {
  if (!key) return { suppliers: [], profiles: new Map() };

  const tradables = await getFriendTradables();
  const draft: WantRow = {
    id: "draft",
    key,
    name: "",
    displayName: "",
    cardId: null,
    image: null,
    quantity: 0,
    note: null,
  };
  const matches = matchWants([draft], tradables);
  const suppliers = matches.get("draft") ?? [];
  const profiles = await profilesByIds(suppliers.map((s) => s.ownerId));

  return { suppliers, profiles };
}

/** The want list plus, for each entry, which friends have it open for trade. */
export async function getWantListView(): Promise<WantListView> {
  const wants = await getWantList();
  const { matches, suppliers } = await matchSuppliersFor(wants);

  return { wants, matches, suppliers };
}

/**
 * Free-text search across every friend's trade binder — the cross-person half
 * of "where is this card?" that `/find` answers for your own collection.
 *
 * Reuses `getFriendTradables()` rather than a second query: it already loads
 * every card a friend has open for trade, RLS-gated by the same
 * friend-plus-tradable-container policy (migration 9) that lets their public
 * profile show it. This shows nothing a visit to `/u/[username]` would not —
 * only a card name search reaches it instead of a friend's name.
 */
export async function matchFriendTradablesByTerm(
  term: string,
): Promise<{ matches: FriendCardMatch[]; suppliers: Map<string, Profile> }> {
  if (term.trim().length < MIN_TERM) return { matches: [], suppliers: new Map() };

  const tradables = await getFriendTradables();
  const matches = matchTradablesByTerm(term, tradables);

  const supplierIds = new Set<string>();
  for (const match of matches) {
    for (const s of match.suppliers) supplierIds.add(s.ownerId);
  }
  const suppliers = await profilesByIds([...supplierIds]);

  return { matches, suppliers };
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

async function hydrateTrades(trades: Trade[]): Promise<TradeDetail[]> {
  if (trades.length === 0) return [];

  const supabase = await createClient();
  const profiles = await profilesByIds(
    trades.flatMap((t) => [t.proposer_id, t.recipient_id].filter((id): id is string => !!id)),
  );

  const { data: itemRows } = await supabase
    .from("trade_items")
    .select("*")
    .in(
      "trade_id",
      trades.map((t) => t.id),
    );

  const items = (itemRows ?? []) as TradeItem[];

  // Two lookups, one authoritative:
  //  - `cards` by the snapshot card_id (migration 23). Immutable and world-
  //    readable, so this is always the right identity, even for a card you
  //    gave away in a completed trade.
  //  - `card_instances` by id, for the live detail (location, condition) an
  //    open trade still has. Anything moved or split since is simply absent.
  const cardIds = [...new Set(items.map((i) => i.card_id).filter((v): v is string => !!v))];
  const { data: cardRows } =
    cardIds.length > 0
      ? await supabase.from("cards").select(CARD_COLUMNS).in("scryfall_id", cardIds)
      : { data: [] };
  const cards = new Map(
    ((cardRows ?? []) as unknown as Card[]).map((c) => [c.scryfall_id, c]),
  );

  // Null once the instance behind it has been deleted (migration 25) — the
  // snapshot columns above are what renders it, so it is simply left out here.
  const instanceIds = [
    ...new Set(items.map((i) => i.card_instance_id).filter((v): v is string => !!v)),
  ];
  const { data: instanceRows } =
    instanceIds.length > 0
      ? await supabase
          .from("card_instances")
          .select(`${INSTANCE_FIELDS}, ${CARD_FIELDS}, locations!location_id ( id, name, type )`)
          .in("id", instanceIds)
      : { data: [] };

  const instances = new Map(
    ((instanceRows ?? []) as unknown as CardInstanceWithCard[]).map((i) => [i.id, i]),
  );

  return trades.map((trade) => ({
    ...trade,
    proposer: (trade.proposer_id ? profiles.get(trade.proposer_id) : null) ?? null,
    recipient: (trade.recipient_id ? profiles.get(trade.recipient_id) : null) ?? null,
    items: items
      .filter((i) => i.trade_id === trade.id)
      .map((i) => {
        const instance = (i.card_instance_id ? instances.get(i.card_instance_id) : null) ?? null;
        return {
          ...i,
          instance,
          card: (i.card_id ? cards.get(i.card_id) : null) ?? instance?.cards ?? null,
          finish: i.finish ?? instance?.finish ?? null,
        };
      }),
  }));
}

/**
 * Just the counts the dashboard's attention strip needs.
 *
 * `getMyTrades` would answer this too, but it hydrates every trade with both
 * profiles, its items and the card instance behind each one — four queries and
 * a lot of rows, to produce two integers. This is one query over one table.
 *
 * Expiry is applied here rather than in SQL so the rule lives in exactly one
 * place (trade-status.ts) and stays testable.
 */
export async function getOpenTradeCounts(): Promise<{
  awaitingYou: number;
  expiringSoon: number;
}> {
  const user = await getCurrentUser();
  if (!user) return { awaitingYou: 0, expiringSoon: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("recipient_id, expires_at, status")
    .eq("status", "proposed")
    .limit(200);

  if (error) {
    console.error("Could not count open trades:", error.message);
    return { awaitingYou: 0, expiringSoon: 0 };
  }

  const open = ((data ?? []) as Array<{
    recipient_id: string;
    expires_at: string | null;
    status: string;
  }>).filter((trade) => !isExpired(trade));

  return {
    awaitingYou: open.filter((t) => t.recipient_id === user.id).length,
    expiringSoon: open.filter((t) => expiringSoon(t.expires_at)).length,
  };
}

/** Every trade you are part of, newest first. */
export async function getMyTrades(): Promise<TradeDetail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Could not load trades: ${error.message}`);
  return hydrateTrades((data ?? []) as Trade[]);
}

export async function getTrade(tradeId: string): Promise<TradeDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("trades").select("*").eq("id", tradeId).maybeSingle();

  if (error) throw new Error(`Could not load that trade: ${error.message}`);
  if (!data) return null;

  const [detail] = await hydrateTrades([data as Trade]);
  return detail ?? null;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * How many unread notifications the signed-in user has.
 *
 * Runs on every page (the nav badge), so it is a `head` count — no rows come
 * back, just the number. Returns 0 rather than throwing if the table is not
 * there yet (migration 00000000000014 not applied).
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    if (error.code !== "PGRST205" && !/relation .*notifications.* does not exist/.test(error.message)) {
      console.error("Could not count notifications:", error.message);
    }
    return 0;
  }

  return count ?? 0;
}

/** The signed-in user's notifications, newest first, with the acting person named. */
export async function getNotifications(limit = 50): Promise<NotificationDetail[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (error.code === "PGRST205") return []; // table not created yet
    throw new Error(`Could not load notifications: ${error.message}`);
  }

  const rows = (data ?? []) as Notification[];
  const actors = await profilesByIds(rows.map((n) => n.actor_id ?? "").filter(Boolean));

  return rows.map((n) => ({
    ...n,
    actor: n.actor_id ? (actors.get(n.actor_id) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

/**
 * Completed trades among you and your friends, newest first.
 *
 * Only completed ones: a feed of proposals would broadcast negotiations that
 * have not happened, which is nobody's business and often nothing at all.
 */
export async function getFeed(limit = 30): Promise<FeedEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not load the feed: ${error.message}`);

  const details = await hydrateTrades((data ?? []) as Trade[]);

  return details.map((trade) => {
    const naming = (direction: "from_proposer" | "from_recipient") =>
      trade.items.filter((i) => i.direction === direction);

    const out = naming("from_proposer");
    const back = naming("from_recipient");
    const names = (list: typeof out) =>
      list.map((i) => (i.card ? cardDisplayName(i.card) : "a card"));

    return {
      trade,
      proposer: trade.proposer,
      recipient: trade.recipient,
      fromProposer: names(out),
      fromRecipient: names(back),
      cardsFromProposer: out.reduce((sum, i) => sum + i.quantity, 0),
      cardsFromRecipient: back.reduce((sum, i) => sum + i.quantity, 0),
    };
  });
}
