/**
 * Deciding which cards the daily sync actually has to write.
 *
 * The sync used to upsert every one of ~118,000 printings each day and stamp
 * last_synced_at and prices_updated_at on all of them, so a row Scryfall had
 * not touched was still rewritten — and, because `cards` carries a dozen
 * indexes, rewritten in every one of them. That write amplification is what
 * timed the batches out (migration 42 has the numbers). Most rows do not
 * change from one day to the next; the fix is to notice that and leave them
 * alone.
 *
 * Each row gets a fingerprint, stored in cards.content_hash. The sync reads the
 * stored fingerprints up front, fingerprints the incoming rows, and writes only
 * the difference.
 *
 * The fingerprint is TWO hashes, not one, because "something changed" is not
 * one question here:
 *
 *   - a price changed      -> write the row and advance prices_updated_at, which
 *                             the UI shows as "prices as of";
 *   - only other data changed (a new image, a corrected type line) -> write the
 *                             row but leave prices_updated_at alone, or the UI
 *                             would claim prices were refreshed when they were not.
 *
 * Stored as "<meta>.<prices>" in the one column, so the schema stays a single
 * nullable text. The database never parses it.
 *
 * What is deliberately NOT hashed: last_synced_at and prices_updated_at (they
 * are stamped with the run's time, so they would differ every day and defeat
 * the point) and content_hash itself.
 *
 * Kept separate from the script so it can be tested without a database.
 */

import { createHash } from "node:crypto";

import type { CardRow } from "./scryfall";

/** The columns Scryfall's prices land in. A change to any of these is a price change. */
export const PRICE_KEYS = [
  "price_usd",
  "price_usd_foil",
  "price_usd_etched",
  "price_eur",
  "price_eur_foil",
] as const satisfies readonly (keyof CardRow)[];

const PRICE_KEY_SET: ReadonlySet<string> = new Set(PRICE_KEYS);

/** Stamped per run, so hashing them would mark every row changed every day. */
const VOLATILE_KEYS: ReadonlySet<string> = new Set(["last_synced_at", "prices_updated_at"]);

export type HashedRow = CardRow & { content_hash: string };
/** A row that leaves prices_updated_at out of the upsert, so the stored value survives. */
export type MetaOnlyRow = Omit<HashedRow, "prices_updated_at">;
/** Everything the sync writes to `cards`. */
export type SyncRow = HashedRow | MetaOnlyRow;

/**
 * JSON with object keys sorted, so the same data always serialises the same
 * bytes whatever order Scryfall (or a future edit to toCardRow) puts the keys
 * in. Matters for card_faces, which is nested JSON straight from the export.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** 80 bits of sha256: far more than enough to tell yesterday's row from today's. */
function digest(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 20);
}

export type Fingerprint = { meta: string; prices: string };

/**
 * Fingerprints a mapped row. Every column not named as a price or as volatile
 * goes into `meta` automatically, so a column added to CardRow later is covered
 * without anyone remembering to list it here.
 */
export function fingerprint(row: CardRow): Fingerprint {
  const meta: Record<string, unknown> = {};
  const prices: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (VOLATILE_KEYS.has(key) || key === "content_hash") continue;
    (PRICE_KEY_SET.has(key) ? prices : meta)[key] = value;
  }
  return { meta: digest(meta), prices: digest(prices) };
}

export function formatHash({ meta, prices }: Fingerprint): string {
  return `${meta}.${prices}`;
}

/** Null for anything that is not a well-formed stored hash, including null itself. */
export function parseHash(stored: string | null | undefined): Fingerprint | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { meta: parts[0], prices: parts[1] };
}

export type WritePlan = {
  /**
   * New rows, never-fingerprinted rows, and rows whose price changed: written
   * whole, prices_updated_at included.
   */
  full: HashedRow[];
  /** Rows whose only change is non-price data: written without prices_updated_at. */
  metaOnly: MetaOnlyRow[];
  /** Rows identical to what is stored: not written at all. */
  unchanged: number;
  /**
   * The ids of the rows in `full` that changed ONLY in price. The mobile
   * catalog carries no prices, so writing these does not make it stale;
   * everything else written does. Ids rather than a count so the sync can
   * classify each chunk as it lands, even when a later chunk fails. A
   * never-fingerprinted row is not in here: we cannot prove its metadata is
   * the same, so it is treated as a catalog change.
   */
  priceOnly: Set<string>;
};

/**
 * Splits a batch into what needs writing and what does not.
 *
 * `existing` maps scryfall_id to the stored content_hash (null for a row that
 * predates the column). An id absent from the map is a new printing.
 *
 * A stored hash that is null or unparseable counts as changed and takes the
 * `full` path: we cannot tell whether its prices moved, so advancing
 * prices_updated_at is the honest reading, and it means the first run after
 * migration 42 rewrites everything once and fills the column in.
 */
export function planWrites(
  rows: readonly CardRow[],
  existing: ReadonlyMap<string, string | null>,
): WritePlan {
  const plan: WritePlan = { full: [], metaOnly: [], unchanged: 0, priceOnly: new Set() };

  for (const row of rows) {
    const next = fingerprint(row);
    const hashed: HashedRow = { ...row, content_hash: formatHash(next) };
    const stored = existing.has(row.scryfall_id)
      ? parseHash(existing.get(row.scryfall_id))
      : null;

    if (!stored || stored.prices !== next.prices) {
      plan.full.push(hashed);
      if (stored && stored.meta === next.meta) plan.priceOnly.add(row.scryfall_id);
    } else if (stored.meta !== next.meta) {
      // Drop the key rather than set it undefined: the upsert's ON CONFLICT
      // only updates the columns present in the payload.
      const { prices_updated_at: _kept, ...rest } = hashed;
      void _kept;
      plan.metaOnly.push(rest);
    } else {
      plan.unchanged += 1;
    }
  }

  return plan;
}

export type HashPage = {
  rows: { scryfall_id: string; content_hash: string | null }[];
  error: { code?: string | null; message: string } | null;
};

/**
 * Reads every stored (scryfall_id, content_hash) pair, keyset-paged on the
 * primary key. Keyset rather than offset: an offset scan re-walks everything
 * before it on every page, which is quadratic over 118,000 rows.
 *
 * Ends on an EMPTY page, not a short one. PostgREST caps a response at its own
 * max-rows setting, which may be below the page size we asked for; treating a
 * short page as the end would then silently stop early and make every later
 * row look new.
 */
export async function loadExistingHashes(
  fetchPage: (after: string | null, size: number) => Promise<HashPage>,
  pageSize = 1000,
): Promise<Map<string, string | null>> {
  const existing = new Map<string, string | null>();
  let after: string | null = null;

  for (;;) {
    const { rows, error } = await fetchPage(after, pageSize);
    if (error) throw new Error(`Could not read stored card hashes: ${error.message}`);
    if (rows.length === 0) return existing;
    for (const row of rows) existing.set(row.scryfall_id, row.content_hash);
    after = rows[rows.length - 1].scryfall_id;
  }
}

/**
 * Guards against a hash read that came back short.
 *
 * If the up-front read returns fewer rows than the table holds — a truncated
 * response, a wrong key, a permissions change — every row it missed looks new
 * and is rewritten, which is precisely the full-table write this whole module
 * exists to avoid, arriving silently on a database that is already struggling.
 * Better to stop with a sentence saying so.
 *
 * Compared against the table's own row count rather than against the previous
 * run's cards_upserted: now that unchanged rows are skipped, a healthy run
 * writes a few hundred rows, so "the last run wrote a lot" no longer says how
 * big the table is. The count is exact and cheap on ~118,000 rows.
 *
 * `floor` keeps a first-ever run, or a tiny dev database, out of it, and the
 * 1% tolerance is slack for a row deleted between the two reads. Returns the
 * message to fail with, or null when the read is plausible.
 */
export function checkHashReadComplete(
  readCount: number,
  tableCount: number,
  { floor = 1000, tolerance = 0.01 }: { floor?: number; tolerance?: number } = {},
): string | null {
  if (tableCount < floor) return null;
  if (readCount >= tableCount * (1 - tolerance)) return null;
  return (
    `Read only ${readCount.toLocaleString()} stored card fingerprints but cards holds ` +
    `${tableCount.toLocaleString()} rows. Continuing would rewrite every row the read ` +
    `missed, which is the full-table write this sync is built to avoid. Investigate ` +
    `the read (row limit, key, permissions), or pass --force to accept a full rewrite.`
  );
}

export type PriorRun = { id: number; status: string; cards_upserted: number };

/**
 * Whether an earlier run may have changed `cards` without the catalog ever
 * being rebuilt from it.
 *
 * The catalog steps run only after a successful sync, and the sync only writes
 * rows that differ. So a run that wrote rows and then died leaves those rows
 * stored with their new hashes: the next run finds nothing to write, reports
 * "nothing changed", and the catalog is never rebuilt from them. To close that,
 * the next run looks at every run since the last success (`runs` is exactly
 * those): a failed one that had written rows, or one still marked `running`
 * (killed hard, count unknown), means the catalog must be republished.
 *
 * `lastPublishedRunId` is the newest run of any status that has a
 * catalog_published_at stamp. A publish covers everything written before it,
 * so a failed run older than that is no longer stale. This is what ends the
 * republishing: a skipped day that triggers a publish records itself as
 * needing one (see the sync), the publish step stamps it, and from the next
 * day on the failure is behind the stamp. Without it a skipped run after a
 * failed one would republish every day forever, because nothing else ever
 * clears the failed row.
 */
export function catalogMayBeStale(runs: readonly PriorRun[], lastPublishedRunId = 0): boolean {
  return runs.some(
    (r) =>
      r.id > lastPublishedRunId &&
      (r.status === "running" || (r.status === "failed" && r.cards_upserted > 0)),
  );
}

/**
 * The one decision the catalog steps in the workflow hang on.
 *
 * True when the catalog must be rebuilt and published: this run changed
 * something the catalog contains, an earlier run died after writing (its rows
 * are already stored, so this run cannot see them as changes), a succeeded run
 * that needed a publish never recorded one (the publish step failed), or the
 * run was forced. Also consulted on a skipped run, because "the export has not
 * changed" says nothing about whether the last publish landed.
 */
export function shouldPublishCatalog(input: {
  catalogChanged: number;
  priorRunIncomplete: boolean;
  unpublishedEarlier: boolean;
  force: boolean;
}): boolean {
  return (
    input.catalogChanged > 0 ||
    input.priorRunIncomplete ||
    input.unpublishedEarlier ||
    input.force
  );
}
