/**
 * Scryfall's `oracle_cards` bulk export, mapped into `public.oracle_cards`.
 *
 * `cards` is one row per PRINTING, so every property of the card itself -- its
 * rules text, type line, legality -- is stored once per printing: Lightning
 * Bolt's oracle text sits in ~80 rows. `oracle_cards` is one row per oracle_id
 * (~39,000), the natural home for those properties and for the trigram search
 * indexes over them (migration 43 has the reasoning and the sizes). This module
 * is the pure half of the loader that fills it: mapping, fingerprinting,
 * diffing and streaming, with no database and no network so it can be tested
 * against fixtures. The loader itself is scripts/sync-oracle-direct.ts.
 *
 * Every value is derived exactly the way toCardRow (src/lib/scryfall.ts)
 * derives the same column for `cards`, front-face fallback included. That is
 * deliberate and tested (scripts/scryfall-oracle.test.ts compares the two on a
 * double-faced fixture): the day a reader moves from `cards.oracle_text` to
 * `oracle_cards.oracle_text`, a Delver of Secrets must not change what it says.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { parser } from "stream-json/jsonl/Parser";

import type { ScryfallCard, ScryfallFace } from "./scryfall";

/** The bulk-data `type` this loader reads, and the scryfall_sync_runs.bulk_type it writes under. */
export const ORACLE_BULK_TYPE = "oracle_cards";

/** A card as the oracle export sends it: the printing shape plus its legalities. */
export type ScryfallOracleCard = ScryfallCard & {
  /** format name -> legal | not_legal | restricted | banned */
  legalities?: Record<string, string>;
};

/**
 * Legalities as stored: JSON of format -> status, WITHOUT the `not_legal`
 * entries. Scryfall sends ~25 formats per card and for most cards most of them
 * are `not_legal`, so the full object is mostly noise (and ~39,000 copies of
 * it). A missing key therefore means "not legal, or a format Scryfall did not
 * list": readers must treat absence as not legal, never as an error.
 */
export type CompactLegalities = Record<string, string>;

/** A row shaped for `insert into public.oracle_cards`. `updated_at` is the database's to stamp. */
export type OracleRow = {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number | null;
  type_line: string | null;
  oracle_text: string | null;
  colors: string[] | null;
  color_identity: string[] | null;
  keywords: string[] | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  produced_mana: string[] | null;
  game_changer: boolean | null;
  layout: string | null;
  legalities: CompactLegalities;
  content_hash: string;
};

/**
 * Column order for COPY, and the one place the row's shape is listed for the
 * loader. `satisfies` makes the compiler refuse a name that is not on OracleRow;
 * scripts/scryfall-oracle.test.ts checks the list is complete.
 */
export const ORACLE_COLUMNS = [
  "oracle_id",
  "name",
  "mana_cost",
  "cmc",
  "type_line",
  "oracle_text",
  "colors",
  "color_identity",
  "keywords",
  "power",
  "toughness",
  "loyalty",
  "produced_mana",
  "game_changer",
  "layout",
  "legalities",
  "content_hash",
] as const satisfies readonly (keyof OracleRow)[];

/** Drops `not_legal`, and sorts the keys so the same legalities always serialise the same bytes. */
export function compactLegalities(
  legalities: Record<string, string> | null | undefined,
): CompactLegalities {
  const out: CompactLegalities = {};
  for (const format of Object.keys(legalities ?? {}).sort()) {
    const status = legalities![format];
    if (status && status !== "not_legal") out[format] = status;
  }
  return out;
}

/**
 * Fingerprint of everything the loader writes except the fingerprint itself.
 * An array, not an object, so the order is the ORACLE_COLUMNS order and never
 * depends on how a future edit orders the literal in toOracleRow. 80 bits of
 * sha256, the same width as cards.content_hash: plenty to tell yesterday's row
 * from today's.
 */
export function hashOracleRow(row: Omit<OracleRow, "content_hash">): string {
  const payload = ORACLE_COLUMNS.filter((c) => c !== "content_hash").map(
    (c) => row[c as keyof typeof row] ?? null,
  );
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
}

/**
 * Maps one oracle-export card to an `oracle_cards` row, or null for a record we
 * cannot key (no oracle_id or no name) -- the loader counts and reports those.
 */
export function toOracleRow(card: ScryfallOracleCard): OracleRow | null {
  // `reversible_card` layouts omit the top-level oracle_id and put it on each
  // face instead; same fallback as toCardRow.
  const oracleId = card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null;
  if (!oracleId || !card.name) return null;

  // Transform and modal double-faced cards carry no top-level cost, rules text
  // or stats, only faces: fall back to the front face. This is `faceOr` in
  // toCardRow, restated because that one is a closure over its own card.
  const front = card.card_faces?.[0];
  const faceOr = <K extends keyof ScryfallFace>(key: K): NonNullable<ScryfallFace[K]> | null =>
    (card[key] as ScryfallFace[K]) ?? front?.[key] ?? null;

  const row: Omit<OracleRow, "content_hash"> = {
    oracle_id: oracleId,
    name: card.name,
    mana_cost: faceOr("mana_cost"),
    // A real 0 is meaningful, so only undefined becomes null.
    cmc: card.cmc ?? null,
    type_line: card.type_line ?? null,
    oracle_text: faceOr("oracle_text"),
    colors: card.colors ?? front?.colors ?? null,
    color_identity: card.color_identity ?? null,
    keywords: card.keywords ?? null,
    power: faceOr("power"),
    toughness: faceOr("toughness"),
    loyalty: faceOr("loyalty"),
    produced_mana: card.produced_mana ?? front?.produced_mana ?? null,
    game_changer: card.game_changer ?? null,
    layout: card.layout ?? null,
    legalities: compactLegalities(card.legalities),
  };
  return { ...row, content_hash: hashOracleRow(row) };
}

export type OraclePlan = {
  /** New rows, and rows whose stored fingerprint differs. The only ones worth writing. */
  changed: OracleRow[];
  unchanged: number;
};

/**
 * Splits a batch into what has to be written and what is already stored
 * exactly so. A null stored hash counts as changed, as it does for `cards`.
 */
export function planOracleWrites(
  rows: readonly OracleRow[],
  stored: ReadonlyMap<string, string | null>,
): OraclePlan {
  const changed: OracleRow[] = [];
  let unchanged = 0;
  for (const row of rows) {
    if (stored.get(row.oracle_id) === row.content_hash) unchanged += 1;
    else changed.push(row);
  }
  return { changed, unchanged };
}

/**
 * Fewer oracle cards than this cannot be a complete export: Scryfall has
 * published ~38,900 and the number only grows. An ABSOLUTE floor, because the
 * relative check below has nothing to compare against on a first load.
 */
export const MIN_ORACLE_CARDS = 20_000;

/**
 * A feed that maps to far fewer cards than expected is a truncated or wrong
 * file, not Scryfall retiring half of Magic. The loader never deletes, so
 * writing it would do no harm, but recording it as a success would hide that
 * the day's data is missing, and on a first load would then be skipped by the
 * unchanged-export check until Scryfall next republished. Two tests: an
 * absolute floor (MIN_ORACLE_CARDS), which covers an empty table, and half of
 * whatever is already stored. Returns a message, or null when the feed looks
 * complete. Same idea as checkHashReadComplete for the printings sync.
 */
export function checkOracleFeedComplete(fed: number, stored: number): string | null {
  if (fed < MIN_ORACLE_CARDS) {
    return (
      `The oracle export mapped to only ${fed.toLocaleString()} cards; a complete export has ` +
      `over ${MIN_ORACLE_CARDS.toLocaleString()}. Refusing to record this as a good run; ` +
      "the download was probably truncated (use --force to override)."
    );
  }
  if (fed < stored * 0.5) {
    return (
      `The oracle export mapped to only ${fed.toLocaleString()} cards but ` +
      `${stored.toLocaleString()} are stored. Refusing to record this as a good run; ` +
      "the download was probably truncated (use --force to override)."
    );
  }
  return null;
}

export type StreamOracleRowsResult = {
  processed: number;
  /** Records with no usable oracle_id or name. */
  skipped: number;
  /** Repeats of an oracle_id already seen; the first wins. */
  duplicates: number;
};

/**
 * Parses the decompressed JSON Lines oracle export and hands mapped rows to
 * `onBatch`. Awaited, so a slow write applies backpressure to the parser.
 *
 * Duplicate oracle_ids are dropped here rather than left to the database: the
 * export should have one row per oracle_id, but a single INSERT ... ON CONFLICT
 * DO UPDATE that names the same key twice fails outright ("cannot affect row a
 * second time"), which would turn one odd record into a failed nightly run.
 */
export async function streamOracleRows(
  source: Readable,
  options: { batchSize: number; onBatch: (rows: OracleRow[]) => Promise<void> },
): Promise<StreamOracleRowsResult> {
  const { batchSize, onBatch } = options;
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const seen = new Set<string>();
  let batch: OracleRow[] = [];
  let processed = 0;
  let skipped = 0;
  let duplicates = 0;
  // pipeline() discards the consumer's error for a generic AbortError when it
  // tears the streams down; keep the real one so the run row can say why.
  let sinkError: unknown = null;

  const flush = async () => {
    if (batch.length === 0) return;
    const toSend = batch;
    batch = [];
    try {
      await onBatch(toSend);
    } catch (error) {
      sinkError = error;
      throw error;
    }
    processed += toSend.length;
  };

  try {
    await pipeline(
      source,
      parser(),
      async function consume(records: AsyncIterable<{ value: ScryfallOracleCard }>) {
        for await (const { value } of records) {
          const row = toOracleRow(value);
          if (!row) {
            skipped += 1;
            continue;
          }
          if (seen.has(row.oracle_id)) {
            duplicates += 1;
            continue;
          }
          seen.add(row.oracle_id);
          batch.push(row);
          if (batch.length >= batchSize) await flush();
        }
      },
    );
  } catch (error) {
    throw sinkError ?? error;
  }
  await flush();

  return { processed, skipped, duplicates };
}
