import { choosePrinting, nameVariants, type MatchedCard, type ParsedRow, type ResolvedRow } from '@upkeep/domain';
import { backend } from './backend';

// Matching pasted rows to printings in `cards`, the same three batched passes as
// src/lib/import/resolve.ts on the web (which explains the reasoning at length;
// read it before changing this): exact Scryfall id, then every printing of
// every name at once, then a prefix lookup for what those missed (double-faced
// cards exported by front face). A 900-line paste is a handful of requests, not
// 900. `cards` is anon-readable and holds no user data, so unlike the collection
// queries nothing here needs an owner filter.
//
// This deliberately re-implements the round trips rather than sharing them: the
// web version is server-only and bound to the Next Supabase client. The pure
// decisions (name spellings, which printing wins) come from @upkeep/domain, so
// the two cannot disagree about *what* a line means, only about how it is fetched.

const BASE_COLUMNS =
  'scryfall_id, name, flavor_name, set_code, set_name, collector_number, image_uri_small, available_finishes, released_at, digital';
const NAME_CHUNK = 100;
const MAX_FALLBACK_LOOKUPS = 150;
const FALLBACK_CONCURRENCY = 6;

// `set_type` arrived in migration 7; probed once so an older database gets a
// slightly worse printing choice rather than a 400 on every import. Only a
// positive answer is remembered, same as the web.
let cachedColumns: string | null = null;
async function cardColumns(): Promise<string> {
  if (cachedColumns) return cachedColumns;
  const withSetType = `${BASE_COLUMNS}, set_type`;
  const { error } = await backend!.from('cards').select(withSetType).limit(1);
  if (error) return BASE_COLUMNS;
  cachedColumns = withSetType;
  return withSetType;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Every printing of every name, paging past PostgREST's per-response cap: a
 * batch containing a basic land matches thousands of rows, and a silently
 * truncated tail makes the exact printing a line named look like it does not
 * exist. Unlike the web version a failed page throws -- an import that quietly
 * reports "no card with that name" for a dropped connection would be a lie.
 */
async function fetchPrintingsByName(columns: string, names: string[], column: 'name' | 'flavor_name'): Promise<MatchedCard[]> {
  if (names.length === 0) return [];
  const out: MatchedCard[] = [];
  let from = 0;
  let pageSize = 100_000;
  for (;;) {
    const { data, error } = await backend!.from('cards').select(columns).in(column, names)
      .order('scryfall_id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as MatchedCard[]));
    if (from === 0) pageSize = data.length || pageSize;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function resolveRows(rows: ParsedRow[]): Promise<ResolvedRow[]> {
  if (rows.length === 0) return [];
  if (!backend) throw new Error('Importing needs a connection to your account.');
  const columns = await cardColumns();

  // Pass 1: exact Scryfall ids.
  const byScryfallId = new Map<string, MatchedCard>();
  const ids = [...new Set(rows.map(r => r.scryfallId).filter((v): v is string => !!v))];
  for (const group of chunk(ids, NAME_CHUNK)) {
    const { data, error } = await backend.from('cards').select(columns).in('scryfall_id', group);
    if (error) throw error;
    for (const card of (data ?? []) as unknown as MatchedCard[]) byScryfallId.set(card.scryfall_id, card);
  }

  // Pass 2: every printing of every spelling a name might be stored under.
  const needName = rows.filter(r => !r.scryfallId || !byScryfallId.has(r.scryfallId));
  const variantsFor = new Map<string, string[]>();
  for (const row of needName) {
    const raw = row.name.trim();
    if (raw && !variantsFor.has(raw)) variantsFor.set(raw, nameVariants(raw));
  }
  const names = [...new Set([...variantsFor.values()].flat())];

  // Filed under the real name and any printed flavor name, lowercased, so
  // "SOL RING" and a crossover card's alternate title both still hit.
  const byName = new Map<string, MatchedCard[]>();
  const add = (card: MatchedCard) => {
    const keys = new Set([lower(card.name)]);
    if (card.flavor_name) keys.add(lower(card.flavor_name));
    for (const key of keys) {
      const list = byName.get(key);
      if (list) list.push(card); else byName.set(key, [card]);
    }
  };

  // A double quote in a name breaks PostgREST's `in` encoding (the row comes
  // back silently missing), so those few go one at a time through .eq().
  const quotedNames = names.filter(n => n.includes('"'));
  const plainNames = names.filter(n => !n.includes('"'));
  for (const group of chunk(plainNames, NAME_CHUNK)) {
    for (const card of await fetchPrintingsByName(columns, group, 'name')) add(card);
    for (const card of await fetchPrintingsByName(columns, group, 'flavor_name')) add(card);
  }
  await mapWithLimit(quotedNames, FALLBACK_CONCURRENCY, async name => {
    for (const column of ['name', 'flavor_name'] as const) {
      const { data, error } = await backend!.from('cards').select(columns).eq(column, name);
      if (error) throw error;
      for (const card of (data ?? []) as unknown as MatchedCard[]) add(card);
    }
  });

  // Pass 3: prefix lookups for what pass 2 missed (front-face-only names).
  const missing = names.filter(n => !byName.has(lower(n)));
  const lookups = missing.slice(0, MAX_FALLBACK_LOOKUPS);
  const found = await mapWithLimit(lookups, FALLBACK_CONCURRENCY, async name => {
    const { data, error } = await backend!.from('cards').select(columns).ilike('name', `${name}%`).limit(200);
    if (error) throw error;
    return { name, cards: (data ?? []) as unknown as MatchedCard[] };
  });
  for (const { name, cards } of found) {
    const key = lower(name);
    // Exact or front-face hits only, so a prefix search for "Bolt" cannot adopt "Bolt Bend".
    const usable = cards.filter(c => lower(c.name) === key || lower(c.name).startsWith(`${key} // `));
    if (usable.length > 0) byName.set(key, usable);
  }

  return rows.map((row): ResolvedRow => {
    if (row.scryfallId) {
      const exact = byScryfallId.get(row.scryfallId);
      if (exact) return { ...row, card: exact, reason: null, warning: null };
    }
    const variants = variantsFor.get(row.name.trim()) ?? [row.name.trim()];
    const candidates = variants.map(v => byName.get(lower(v))).find(list => list?.length) ?? [];
    if (candidates.length === 0) {
      const overflow = missing.length > MAX_FALLBACK_LOOKUPS && !variants.some(v => lookups.includes(v));
      return {
        ...row, card: null, warning: null,
        reason: overflow ? 'Too many unknown names in one import to look this one up.' : 'No card with that name in the database.',
      };
    }
    const chosen = choosePrinting(row, candidates);
    if (!chosen) return { ...row, card: null, warning: null, reason: 'No usable printing.' };
    return { ...row, card: chosen.card, reason: null, warning: chosen.warning };
  });
}
