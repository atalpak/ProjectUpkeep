import { backend } from './backend';
import { CollectionAuthError } from './collection';
import { fetchDeckTiles, type DeckTile } from './decks';
import { fetchFriendSupplyCounts, fetchWantList } from './cardDetails';

// The Dashboard's numbers: where the collection stands, and what needs a
// decision. Mirrors the web dashboard (src/app/(app)/dashboard/page.tsx) and
// its queries; every read of the user's own rows scopes on the owner
// explicitly (CLAUDE.md constraint 3). Prices are a display-only Scryfall
// estimate, never a valuation engine.

export type ColourBucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'M' | 'C';
export const COLOUR_BUCKETS: ColourBucket[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
export const COLOUR_LABELS: Record<ColourBucket, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolor', C: 'Colorless' };

export type DashboardData = {
  totalCards: number;
  totalEntries: number;
  unsortedCards: number;
  valueTotal: number;
  unpricedEntries: number;
  mostValuable: { name: string; cardId: string; value: number } | null;
  colours: { bucket: ColourBucket; count: number }[];
  recent: { id: string; cardId: string; name: string; imageSmall: string | null }[];
  decks: DeckTile[];
  /** Wish-list cards that at least one friend has open for trade. */
  wishMatches: { name: string; cardId: string; friends: number }[];
  /** Trade proposals waiting on you. */
  tradesAwaiting: number;
};

type Row = {
  quantity: number; finish: string; location_id: string | null; card_id: string; card_name: string; card_colors: string[] | null;
  card_price_usd: number | string | null; card_price_usd_foil: number | string | null; card_price_usd_etched: number | string | null;
};

const num = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Foil and etched fall back to the plain price when Scryfall has no separate one (an estimate, like the web app's). */
function priceOf(r: Row): number | null {
  const plain = num(r.card_price_usd);
  if (r.finish === 'foil') return num(r.card_price_usd_foil) ?? plain;
  if (r.finish === 'etched') return num(r.card_price_usd_etched) ?? plain;
  return plain;
}

function bucketFor(colors: string[] | null): ColourBucket {
  const five = (colors ?? []).filter(c => 'WUBRG'.includes(c));
  if (five.length === 0) return 'C';
  if (five.length > 1) return 'M';
  return five[0] as ColourBucket;
}

const PAGE = 1000;
const CAP = 20_000;

// Counts every copy you own, including ones sleeved into decks (the Collection list hides those).
async function fetchRows(userId: string): Promise<Row[]> {
  if (!backend) throw new Error('Not connected.');
  const rows: Row[] = [];
  for (let from = 0; from < CAP; from += PAGE) {
    const { data, error } = await backend
      .from('collection_entries')
      .select('quantity,finish,location_id,card_id,card_name,card_colors,card_price_usd,card_price_usd_foil,card_price_usd_etched')
      // Mandatory: a friend's tradable binder is readable through RLS.
      .eq('owner_user_id', userId)
      // A stable order, or paging can skip or repeat rows and the totals drift.
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) {
      if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
      throw new Error(error.message);
    }
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function fetchDashboard(userId: string): Promise<DashboardData> {
  if (!backend) throw new Error('Not connected.');
  const [rows, recentRes, decks, wants, tradesRes] = await Promise.all([
    fetchRows(userId),
    backend
      .from('collection_entries')
      .select('id,card_id,card_name,card_image_uri_small')
      .eq('owner_user_id', userId)
      .order('acquired_at', { ascending: false })
      .limit(8),
    fetchDeckTiles(userId),
    fetchWantList(userId).catch(() => []),
    backend.from('trades').select('recipient_id,expires_at,status').eq('status', 'proposed').eq('recipient_id', userId).limit(200),
  ]);
  if (recentRes.error) throw new Error(recentRes.error.message);

  let totalCards = 0, unsortedCards = 0, valueTotal = 0, unpricedEntries = 0;
  let mostValuable: DashboardData['mostValuable'] = null;
  const colourCounts = new Map<ColourBucket, number>();
  for (const r of rows) {
    totalCards += r.quantity;
    if (r.location_id === null) unsortedCards += r.quantity;
    const price = priceOf(r);
    if (price === null) unpricedEntries += 1;
    else {
      valueTotal += price * r.quantity;
      if (!mostValuable || price > mostValuable.value) mostValuable = { name: r.card_name, cardId: r.card_id, value: price };
    }
    const b = bucketFor(r.card_colors);
    colourCounts.set(b, (colourCounts.get(b) ?? 0) + r.quantity);
  }

  // Which wished-for cards a friend could fill. Best-effort: a failure just hides the section.
  const supply = await fetchFriendSupplyCounts(userId, [...new Set(wants.map(w => w.oracleId))]).catch(() => new Map<string, number>());
  const seen = new Set<string>();
  const wishMatches = wants.flatMap(w => {
    const friends = supply.get(w.oracleId) ?? 0;
    if (friends === 0 || seen.has(w.oracleId)) return [];
    seen.add(w.oracleId);
    return [{ name: w.name, cardId: w.cardId, friends }];
  });

  const now = Date.now();
  const tradesAwaiting = (tradesRes.data ?? []).filter(t => t.recipient_id === userId && (!t.expires_at || Date.parse(t.expires_at as string) > now)).length;

  return {
    totalCards, totalEntries: rows.length, unsortedCards, valueTotal, unpricedEntries, mostValuable,
    colours: COLOUR_BUCKETS.filter(b => (colourCounts.get(b) ?? 0) > 0).map(bucket => ({ bucket, count: colourCounts.get(bucket)! })),
    recent: (recentRes.data ?? []).map(r => ({ id: r.id as string, cardId: r.card_id as string, name: r.card_name as string, imageSmall: (r.card_image_uri_small as string | null) ?? null })),
    decks, wishMatches, tradesAwaiting,
  };
}
