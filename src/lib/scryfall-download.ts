/**
 * Downloads Scryfall's bulk export to disk before anything is upserted.
 *
 * On 2026-09-18 (run 35351338797) the sync died about five minutes in with
 * `SocketError: other side closed`. The download used to be consumed as it
 * arrived, with each 500-row batch upserted before the parser was allowed to
 * read the next chunk (that backpressure is what keeps memory flat). So when
 * the database stalled on statement timeouts, the open HTTP body stalled with
 * it, and the remote hung up on a client that had stopped reading. Fetching the
 * whole file first decouples the two: the download runs at network speed
 * regardless of how the database is doing, and the slow part happens against a
 * local file that cannot time out.
 *
 * The file is the export exactly as served (gzipped). Decompression and JSON
 * parsing still stream from disk, so nothing is ever buffered whole.
 *
 * Three properties matter to the retry policy in scripts/sync-retry.ts:
 *
 *   - Every call gets its own freshly created directory, so a retry can never
 *     find, append to or trust a previous attempt's partial file.
 *   - The directory is removed in a `finally`, on success and on every failure,
 *     so a runner does not accumulate half-downloaded files.
 *   - A file shorter than the server promised is rejected *before* `consume` runs,
 *     as a network error. Otherwise a truncated download would only surface as
 *     a gzip error after rows had already been upserted.
 *
 * Kept out of scripts/sync-scryfall.ts, which runs `main()` on import, so the
 * lifecycle can be tested with fake sources and no network.
 */

import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** What `open` hands back: the bytes as served, and how many were promised. */
export type DownloadSource = {
  body: Readable | ReadableStream<Uint8Array>;
  /** From Content-Length. Null when the server did not say; the check is then skipped. */
  expectedBytes: number | null;
};

export type DownloadInfo = { bytes: number; ms: number };

export type DownloadOptions = {
  /** Parent directory for the per-call temp directory. Defaults to os.tmpdir(). */
  tmpRoot?: string;
  /** Injected so tests do not depend on the real clock. */
  now?: () => number;
  /** Injected so a test can make cleanup fail. Defaults to a recursive, forced rm. */
  remove?: (dir: string) => Promise<void>;
  /** A cleanup failure must not mask the error that got us here; report it instead. */
  onCleanupError?: (error: unknown, dir: string) => void;
};

/**
 * A short download. Carries the codes the retry policy already treats as "the
 * connection went away", so it is retried as a network failure without
 * sync-retry.ts needing to know this module exists.
 */
export function incompleteDownloadError(received: number, expected: number): Error {
  const cause = Object.assign(new Error("other side closed"), {
    code: "ERR_STREAM_PREMATURE_CLOSE",
  });
  return new Error(
    `Bulk download ended early: received ${received} of ${expected} bytes`,
    { cause },
  );
}

/**
 * Opens the source, writes it to a unique temp file, checks it is complete, and
 * calls `consume(path, info)` with the file in place. The temp directory is removed
 * when `consume` settles, however it settles.
 */
export async function withDownloadedFile<T>(
  open: () => Promise<DownloadSource>,
  consume: (path: string, info: DownloadInfo) => Promise<T>,
  options: DownloadOptions = {},
): Promise<T> {
  const {
    tmpRoot = tmpdir(),
    now = Date.now,
    remove = (d: string) => rm(d, { recursive: true, force: true }),
    onCleanupError = () => {},
  } = options;

  // mkdtemp gives a name no other attempt or process shares.
  const dir = await mkdtemp(join(tmpRoot, "upkeep-scryfall-"));
  try {
    const startedAt = now();
    const { body, expectedBytes } = await open();
    const path = join(dir, "bulk.jsonl.gz");

    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    const source =
      body instanceof Readable
        ? body
        : Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

    // pipeline() rather than .pipe(): it forwards a source error (the dropped
    // connection) to the caller and closes the file handle either way.
    await pipeline(source, counter, createWriteStream(path));

    if (expectedBytes !== null && bytes !== expectedBytes) {
      throw incompleteDownloadError(bytes, expectedBytes);
    }

    return await consume(path, { bytes, ms: now() - startedAt });
  } finally {
    try {
      await remove(dir);
    } catch (error) {
      onCleanupError(error, dir);
    }
  }
}

/** Parses a Content-Length header value; anything unusable means "unknown". */
export function parseContentLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
