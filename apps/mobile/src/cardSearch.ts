import { matchesAdvancedCard, type AdvancedCardFilter } from '@upkeep/domain';
import { backend } from './backend';

// Advanced card search over the whole Scryfall `cards` table -- every printing
// that exists, not just what anyone owns -- the mobile twin of the web app's
// src/lib/cards/search.ts. It queries Supabase rather than the on-device
// catalog because that catalog only carries what the scanner needs (names,
// sets, finishes, art), not colours, mana value, types or rules text.
//
// `cards` is public Scryfall data, so there is deliberately no owner scoping
// here (see .claude/rules/data-access.md); this is not a collection query.

export type CardSearchResult = {
  name: string;
  printingCount: number;
  /** Small crop, for the results grid. */
  imageSmall: string | null;
  /** Full-size art, for the enlarged view. */
  image: string | null;
  sampleCardId: string;
  flavorName: string | null;
  /** The sample printing's layout; with the name it is what decides whether the tile can flip. */
  layout: string | null;
};

type Row = {
  name: string;
  flavor_name: string | null;
  image_uri: string | null;
  image_uri_small: string | null;
  scryfall_id: string;
  released_at: string | null;
  colors: string[] | null;
  loyalty: string | null;
  layout: string | null;
};

// No ORDER BY in the query: `cards.released_at` has no index, and sorting a
// facet-only match (tens of thousands of rows) blows the database's statement
// timeout (measured: ~3s -> "canceling statement due to statement timeout",
// versus ~0.4s unordered). "Newest printing as the sample" is done in
// application code below instead.
//
// PostgREST silently caps one response at 1000 rows, so this pages. Colour
// (exactly / at most) and loyalty are matched after the fetch, which is why
// the cap is generous: too tight and older matching cards drop out unannounced.
const PAGE = 1000;
const FETCH_CAP = 2000;

function build(filter: AdvancedCardFilter) {
  let query = backend!
    .from('cards')
    .select('name, flavor_name, image_uri, image_uri_small, scryfall_id, released_at, colors, loyalty, layout')
    .eq('digital', false);

  for (const word of filter.name.trim().split(/\s+/).filter(Boolean)) query = query.ilike('name', `%${word}%`);
  if (filter.type.trim()) query = query.ilike('type_line', `%${filter.type.trim()}%`);
  if (filter.oracle.trim()) query = query.ilike('oracle_text', `%${filter.oracle.trim()}%`);
  if (filter.set.trim()) query = query.eq('set_code', filter.set.trim().toLowerCase());
  if (filter.rarity.trim()) query = query.eq('rarity', filter.rarity.trim().toLowerCase());
  if (filter.cmc) {
    const { op, value } = filter.cmc;
    if (op === 'eq') query = query.eq('cmc', value);
    else if (op === 'ne') query = query.neq('cmc', value);
    else if (op === 'gt') query = query.gt('cmc', value);
    else if (op === 'gte') query = query.gte('cmc', value);
    else if (op === 'lt') query = query.lt('cmc', value);
    else query = query.lte('cmc', value);
  }
  // Any-overlap is the widest useful SQL pre-filter for every colour mode;
  // matchesAdvancedCard does the exact comparison afterwards.
  if (filter.colors.length > 0) query = query.overlaps('colors', filter.colors);
  return query;
}

/** One entry per card name, newest printing as the sample, sorted by name.
 *  `capped` means the match set was larger than what one search reads. */
export async function searchCards(
  filter: AdvancedCardFilter,
  limit = 60,
): Promise<{ results: CardSearchResult[]; total: number; capped: boolean; error: string | null }> {
  if (!backend) return { results: [], total: 0, capped: false, error: 'Search needs an internet connection and an account.' };

  const rows: Row[] = [];
  for (let from = 0; from < FETCH_CAP; from += PAGE) {
    const { data, error } = await build(filter).range(from, from + PAGE - 1).returns<Row[]>();
    if (error) return { results: [], total: 0, capped: false, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const byName = new Map<string, CardSearchResult>();
  const newest = new Map<string, string>();
  for (const row of rows) {
    if (!matchesAdvancedCard(row, filter)) continue;
    const existing = byName.get(row.name);
    if (existing) {
      existing.printingCount += 1;
      if ((row.released_at ?? '') > (newest.get(row.name) ?? '')) {
        newest.set(row.name, row.released_at ?? '');
        Object.assign(existing, { imageSmall: row.image_uri_small, image: row.image_uri, sampleCardId: row.scryfall_id, flavorName: row.flavor_name, layout: row.layout });
      }
      continue;
    }
    newest.set(row.name, row.released_at ?? '');
    byName.set(row.name, {
      name: row.name,
      printingCount: 1,
      imageSmall: row.image_uri_small,
      image: row.image_uri,
      sampleCardId: row.scryfall_id,
      flavorName: row.flavor_name,
      layout: row.layout,
    });
  }
  const all = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Hitting the fetch cap means printings past it were never seen.
  return { results: all.slice(0, limit), total: all.length, capped: rows.length >= FETCH_CAP, error: null };
}
