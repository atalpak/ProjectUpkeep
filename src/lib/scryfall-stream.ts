/**
 * Streaming reader for Scryfall's bulk export.
 *
 * The `default_cards` export is JSON Lines — one card object per line — a few
 * hundred megabytes uncompressed. Buffering it would blow the memory budget of
 * any free-tier runner, so it is parsed incrementally and handed to the caller
 * in batches.
 *
 * Kept out of scripts/sync-scryfall.ts so this — the part most likely to break
 * quietly — can be tested against a fixture without a network or a database.
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { parser } from "stream-json/jsonl/Parser";

import { toCardRow, type CardRow, type ScryfallCard } from "./scryfall";

export type StreamCardRowsOptions = {
  /** Rows per batch handed to onBatch. */
  batchSize: number;
  /** Written to every row's last_synced_at, so one run stamps one time. */
  syncedAt: string;
  /** Stop after roughly this many rows. For smoke tests. */
  limit?: number | null;
  /**
   * Called once per batch. Awaited, which is what applies backpressure: while
   * the upsert is in flight the parser is not being read from.
   */
  onBatch: (rows: CardRow[]) => Promise<void>;
};

export type StreamCardRowsResult = {
  /** Rows successfully handed to onBatch. */
  processed: number;
  /** Records the mapper refused (missing fields our NOT NULL columns need). */
  skipped: number;
  /** True if `limit` cut the run short. */
  stoppedEarly: boolean;
};

/**
 * Parses JSON Lines of Scryfall cards from `source`, mapping and batching them
 * into `onBatch`.
 *
 * Expects decompressed bytes: the bulk export ships gzipped, and unwrapping it
 * is the caller's job (see scripts/sync-scryfall.ts). Accepts a Node stream or
 * a web ReadableStream, so a fixture or a file handle works in tests.
 */
export async function streamCardRows(
  source: Readable | ReadableStream<Uint8Array>,
  options: StreamCardRowsOptions,
): Promise<StreamCardRowsResult> {
  const { batchSize, syncedAt, limit = null, onBatch } = options;

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const nodeStream =
    source instanceof Readable
      ? source
      : Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]);

  let batch: CardRow[] = [];
  let processed = 0;
  let skipped = 0;
  let stoppedEarly = false;

  /**
   * When the consumer throws, pipeline() destroys the upstream streams and
   * rejects with a generic AbortError, discarding the real cause. Since the
   * caller records that message into scryfall_sync_runs.error_message, losing
   * it would turn every upsert failure into an unactionable "The operation was
   * aborted". Hold on to the original and rethrow it below.
   */
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
      nodeStream,
      parser(),
      async function consume(records: AsyncIterable<{ value: ScryfallCard }>) {
        for await (const { value } of records) {
          // Drain rather than break: breaking out of a for-await inside a
          // pipeline destroys the stream and surfaces as a spurious error.
          if (stoppedEarly) continue;

          const row = toCardRow(value, syncedAt);
          if (!row) {
            skipped += 1;
            continue;
          }

          batch.push(row);

          if (batch.length >= batchSize) {
            await flush();
            if (limit !== null && processed >= limit) {
              stoppedEarly = true;
            }
          }
        }
      },
    );
  } catch (error) {
    throw sinkError ?? error;
  }

  if (!stoppedEarly) await flush();

  return { processed, skipped, stoppedEarly };
}
