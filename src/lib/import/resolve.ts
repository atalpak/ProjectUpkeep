import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ParsedRow } from "@/lib/import/parse";
import { nameVariants } from "@/lib/import/name-variants";
import { choosePrinting, type MatchedCard } from "@/lib/import/select";

/**
 * Matching parsed rows to printings in our `cards` table.
 *
 * The hard part is doing it in a handful of queries rather than one per row: a
 * 900-line Moxfield export should not be 900 round trips. So resolution works
 * in passes, each one a batched lookup, and each row takes the best identifier
 * it has:
 *
 *   1. Scryfall id, when the export carries one (ManaBox, Archidekt). Exact.
 *   2. Card name, batched — which fetches every printing of every name at once
 *      and then narrows per row by set and collector number in memory.
 *   3. A prefix lookup for the names pass 2 missed, which is what catches
 *      double-faced cards: exporters write "Fable of the Mirror-Breaker" where
 *      our row is "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki".
 *
 * A row that names a set we cannot find still resolves, to the default printing
 * of that name, and says so. Refusing it outright would be tidier but would
 * strand cards over a set code that a provider spells differently.
 */

export type { MatchedCard } from "@/lib/import/select";

export type ResolvedRow = ParsedRow & {
  /** The printing we will file, or null when nothing matched. */
  card: MatchedCard | null;
  /** Why the row could not be matched. Set only when `card` is null. */
  reason: string | null;
  /** A match we made, but with a caveat worth showing before committing. */
  warning: string | null;
};

const BASE_CARD_COLUMNS =
  "scryfall_id, name, set_code, set_name, collector_number, image_uri_small, " +
  "available_finishes, released_at, digital";

/**
 * Columns to select, with `set_type` only if the database has it.
 *
 * `set_type` arrives in migration 00000000000007. Naming it unconditionally
 * would make every import fail with a 400 on a database where that migration
 * has not been applied, so its presence is probed once and remembered.
 *
 * Only a positive result is cached: a negative one has to be re-checked, or the
 * server would keep ignoring the column for its whole lifetime after the
 * migration finally ran.
 */
let cachedColumns: string | null = null;

async function cardColumns(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  if (cachedColumns) return cachedColumns;

  const withSetType = `${BASE_CARD_COLUMNS}, set_type`;
  const { error } = await supabase.from("cards").select(withSetType).limit(1);

  if (error) return BASE_CARD_COLUMNS;
  cachedColumns = withSetType;
  return withSetType;
}

/** Names per `in` filter. Keeps the URL well inside PostgREST's limits. */
const NAME_CHUNK = 100;

/**
 * Reads every printing of every name in `names`, paging past PostgREST's
 * per-response row cap (Supabase's default is 1000).
 *
 * A name batch that contains a basic land, or a staple like Sol Ring, matches
 * far more than 1000 rows. Without paging, the tail is silently dropped and the
 * printings that fall off — often the exact one an import line named — look, to
 * choosePrinting, like the set was never printed at all. So the first page's
 * length is taken as the server's real cap and the query is drained from there.
 * Ordered by the primary key so the pages do not overlap or skip.
 */
async function fetchPrintingsByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columns: string,
  names: string[],
): Promise<MatchedCard[]> {
  if (names.length === 0) return [];

  const out: MatchedCard[] = [];
  let from = 0;
  let pageSize = 100_000;

  for (;;) {
    const { data, error } = await supabase
      .from("cards")
      .select(columns)
      .in("name", names)
      .order("scryfall_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error || !data || data.length === 0) break;
    out.push(...(data as unknown as MatchedCard[]));

    if (from === 0) pageSize = data.length || pageSize;
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

/** How many single-name fallback lookups we are willing to make. */
const MAX_FALLBACK_LOOKUPS = 150;
const FALLBACK_CONCURRENCY = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Runs `worker` over `items` a few at a time, preserving input order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function resolveRows(rows: ParsedRow[]): Promise<ResolvedRow[]> {
  if (rows.length === 0) return [];

  const supabase = await createClient();
  const columns = await cardColumns(supabase);

  // ---- Pass 1: exact Scryfall ids ----------------------------------------
  const byScryfallId = new Map<string, MatchedCard>();
  const ids = [...new Set(rows.map((r) => r.scryfallId).filter((v): v is string => !!v))];

  for (const group of chunk(ids, NAME_CHUNK)) {
    const { data } = await supabase.from("cards").select(columns).in("scryfall_id", group);
    for (const card of (data ?? []) as unknown as MatchedCard[]) {
      byScryfallId.set(card.scryfall_id, card);
    }
  }

  // ---- Pass 2: every printing of every name we still need ------------------
  const needName = rows.filter((r) => !r.scryfallId || !byScryfallId.has(r.scryfallId));

  // Each row contributes every spelling its name might have in the database,
  // not just the one the exporter chose. A two-part card reaches us as
  // "A // B", "A / B" or "A" depending on the tool, and only one of those is
  // what we store — so all of them are looked up and whichever hits wins. See
  // name-variants.ts.
  const variantsFor = new Map<string, string[]>();
  for (const row of needName) {
    const raw = row.name.trim();
    if (raw && !variantsFor.has(raw)) variantsFor.set(raw, nameVariants(raw));
  }
  const names = [...new Set([...variantsFor.values()].flat())];

  // Keyed on the lowercased name so an export that shouts SOL RING still hits.
  const byName = new Map<string, MatchedCard[]>();
  const add = (card: MatchedCard) => {
    const key = lower(card.name);
    const list = byName.get(key);
    if (list) list.push(card);
    else byName.set(key, [card]);
  };

  // A name containing a double quote cannot go through `in`: PostgREST encodes
  // that filter as a quoted, comma-joined list, and an embedded quote breaks
  // the encoding so the row silently comes back missing. Verified against
  // `Kongming, "Sleeping Dragon"`, which .eq() finds and .in() does not.
  // Commas are handled correctly; quotes are not. There are only a handful of
  // such cards, so they go one at a time.
  const quotedNames = names.filter((n) => n.includes('"'));
  const plainNames = names.filter((n) => !n.includes('"'));

  for (const group of chunk(plainNames, NAME_CHUNK)) {
    for (const card of await fetchPrintingsByName(supabase, columns, group)) add(card);
  }

  await mapWithLimit(quotedNames, FALLBACK_CONCURRENCY, async (name) => {
    const { data } = await supabase.from("cards").select(columns).eq("name", name);
    for (const card of (data ?? []) as unknown as MatchedCard[]) add(card);
  });

  // ---- Pass 3: prefix lookups for whatever pass 2 missed -------------------
  // Catches case differences and, mainly, double-faced cards whose exported
  // name is only the front face.
  const missing = names.filter((n) => !byName.has(lower(n)));
  const lookups = missing.slice(0, MAX_FALLBACK_LOOKUPS);

  const found = await mapWithLimit(lookups, FALLBACK_CONCURRENCY, async (name) => {
    // PostgREST treats % and , specially inside a filter value; a card name
    // contains neither, but escaping the wildcard we add is still the honest
    // way to write this.
    const { data } = await supabase
      .from("cards")
      .select(columns)
      .ilike("name", `${name}%`)
      .limit(200);
    return { name, cards: (data ?? []) as unknown as MatchedCard[] };
  });

  for (const { name, cards } of found) {
    const key = lower(name);
    // Keep only an exact hit or a front-face hit — a prefix search for "Bolt"
    // would otherwise adopt "Bolt Bend".
    const usable = cards.filter(
      (c) => lower(c.name) === key || lower(c.name).startsWith(`${key} // `),
    );
    if (usable.length > 0) byName.set(key, usable);
  }

  // ---- Assemble -----------------------------------------------------------
  return rows.map((row): ResolvedRow => {
    if (row.scryfallId) {
      const exact = byScryfallId.get(row.scryfallId);
      if (exact) return { ...row, card: exact, reason: null, warning: null };
    }

    // First spelling that matched something. Ordered best-first, so an exact
    // hit is preferred over the front-face fallback.
    const variants = variantsFor.get(row.name.trim()) ?? [row.name.trim()];
    const candidates =
      variants.map((variant) => byName.get(lower(variant))).find((list) => list?.length) ?? [];

    if (candidates.length === 0) {
      const overflow =
        missing.length > MAX_FALLBACK_LOOKUPS &&
        !variants.some((variant) => lookups.includes(variant));
      return {
        ...row,
        card: null,
        warning: null,
        reason: overflow
          ? "Too many unknown names in one import to look this one up."
          : "No card with that name in the database.",
      };
    }

    const chosen = choosePrinting(row, candidates);
    if (!chosen) {
      return { ...row, card: null, warning: null, reason: "No usable printing." };
    }

    return { ...row, card: chosen.card, reason: null, warning: chosen.warning };
  });
}
