/**
 * Writing a bulk sync into Postgres without one slow batch losing the run.
 *
 * The sync upserts ~118,000 printings in batches. On 2026-09-08 a scheduled run
 * died 100,000 rows in with
 *
 *     canceling statement due to statement timeout
 *
 * and that single batch failed the whole job — leaving the table partly
 * refreshed, which is the worst of the three possible outcomes. A wholly stale
 * table is at least uniformly stale; a partly-refreshed one shows some cards at
 * today's price and some at last week's, with nothing to say which is which.
 *
 * A statement timeout is not a data error. It says this particular statement
 * was too much work for the time allowed, right now — and the same rows in two
 * smaller statements will usually go through. So a timeout halves the chunk and
 * retries, and the smaller size *sticks for the rest of the run*: having learned
 * that 500 is too big today, there is no sense discovering it again 200 times.
 *
 * Kept separate from the script, with the write injected, so the escalation can
 * be tested against a fake that fails on demand rather than by waiting for a
 * free-tier database to have a bad afternoon.
 */

import type { CardRow } from "@/lib/scryfall";

/** Just enough of a PostgREST error to decide what to do about it. */
export type WriteError = { code?: string | null; message: string };
export type WriteResult = { error: WriteError | null };
export type ChunkWriter = (rows: CardRow[]) => Promise<WriteResult>;

/**
 * SQLSTATE 57014, `query_canceled` — what Postgres raises when
 * `statement_timeout` fires. Matched on the message too: PostgREST does not
 * always pass the code through, and the message is stable.
 */
export function isStatementTimeout(error: WriteError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "57014") return true;
  return /statement timeout|canceling statement/i.test(error.message);
}

export type ChunkedWriterOptions = {
  write: ChunkWriter;
  /** Rows per statement to start with. */
  startSize: number;
  /**
   * The floor. A timeout on a chunk this small is a real problem — an
   * unreachable database, a lock, a table that needs attention — not something
   * to be solved by halving again, and 118,000 rows written 25 at a time would
   * outlast the job's own timeout anyway.
   */
  minSize?: number;
  /** Attempts for errors that are not timeouts, e.g. a dropped connection. */
  maxRetries?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  onNotice?: (message: string) => void;
};

export type ChunkedWriter = {
  /** Writes every row, splitting and retrying as needed. Throws if it cannot. */
  write: (rows: CardRow[]) => Promise<void>;
  /** The chunk size currently in use, after any shrinking. */
  chunkSize: () => number;
  /** How many times a chunk had to be split. Reported at the end of a run. */
  splits: () => number;
  /** How many non-timeout errors were retried away. */
  retries: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createChunkedWriter(options: ChunkedWriterOptions): ChunkedWriter {
  const {
    write,
    startSize,
    minSize = 25,
    maxRetries = 3,
    sleep = defaultSleep,
    onNotice = () => {},
  } = options;

  if (!Number.isFinite(startSize) || startSize <= 0) {
    throw new Error("startSize must be a positive integer");
  }

  let size = Math.max(minSize, Math.floor(startSize));
  let splits = 0;
  let retries = 0;

  /** One statement, with the escalation attached. */
  async function writeChunk(rows: CardRow[]): Promise<void> {
    if (rows.length === 0) return;

    let { error } = await write(rows);

    // Two failures with two different answers. A dropped connection or a blip
    // says nothing about the size of the statement, so retry it whole; a
    // timeout says exactly that, so stop retrying and go and split. The loop
    // exits the moment the error becomes a timeout — retrying the full chunk
    // once more before halving it is a statement we already know is too big.
    for (
      let attempt = 1;
      error && !isStatementTimeout(error) && attempt <= maxRetries;
      attempt += 1
    ) {
      await sleep(attempt * 1000);
      retries += 1;
      error = (await write(rows)).error;
    }

    if (!error) return;

    if (isStatementTimeout(error)) {
      if (rows.length <= minSize) {
        throw new Error(
          `Upsert of ${rows.length} cards timed out at the smallest chunk size ` +
            `(${minSize}). The database is not keeping up: ${error.message}`,
        );
      }

      const half = Math.ceil(rows.length / 2);
      splits += 1;
      if (half < size) {
        size = Math.max(minSize, half);
        onNotice(
          `a chunk of ${rows.length} timed out; using ${size} for the rest of this run`,
        );
      }

      // Sequential, not parallel: two halves racing each other is the same
      // total work arriving at once, which is what timed out in the first place.
      await writeChunk(rows.slice(0, half));
      await writeChunk(rows.slice(half));
      return;
    }

    throw new Error(
      `Upsert of ${rows.length} cards failed after ${maxRetries} retries: ${error.message}`,
    );
  }

  return {
    async write(rows: CardRow[]) {
      for (let start = 0; start < rows.length; ) {
        // Re-read `size` each pass: a timeout inside the previous chunk may
        // have shrunk it, and the rest of this batch should feel that too.
        const take = Math.min(size, rows.length - start);
        await writeChunk(rows.slice(start, start + take));
        start += take;
      }
    },
    chunkSize: () => size,
    splits: () => splits,
    retries: () => retries,
  };
}
