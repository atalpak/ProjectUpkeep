/**
 * Scryfall oracle loader: `oracle_cards` bulk export -> public.oracle_cards,
 * over a DIRECT Postgres connection with COPY.
 *
 * This is the first thing in the project to talk to Postgres directly instead
 * of through PostgREST, and it is a separate script from sync-scryfall.ts on
 * purpose:
 *
 *   - It proves the connection before anything depends on it. The printings
 *     sync (sync-scryfall.ts, PostgREST, service key) is untouched and stays
 *     the fallback; moving it to COPY is a follow-up once this has run cleanly
 *     in production with the real secret. Extending that script instead would
 *     have put the working nightly job's failure modes in the way of an
 *     experiment.
 *   - It has a different failure profile. It needs a different secret, and
 *     it must be able to be absent (no secret -> the workflow step skips)
 *     without the printings sync noticing.
 *   - The two share nothing at run time but the bookkeeping table.
 *
 * What it does, in order:
 *
 *   1. Finds the `oracle_cards` entry in Scryfall's bulk-data index.
 *   2. Skips (records a `skipped` run, downloads nothing) when the entry's
 *      updated_at equals the last succeeded run's AND the table is populated.
 *      The table check is what "and the content matches" comes to without a
 *      download: an unchanged timestamp over an empty or wiped table must not
 *      skip. --force overrides. A same-timestamp export whose rows nevertheless
 *      differ is not a case Scryfall produces; if it ever did, --force reloads
 *      and the per-row diff below writes only what differs.
 *   3. Streams the gzipped JSON Lines through the mapper, and diffs each batch
 *      against the stored (oracle_id, content_hash) pairs read up front.
 *   4. COPYs ONLY the changed rows into a session-local staging table, then
 *      moves them with one INSERT ... ON CONFLICT DO UPDATE per chunk. One
 *      statement per ~2,000 rows instead of one request per 500 is the point of
 *      leaving PostgREST; COPY skips per-row parse and plan cost, and the
 *      set-based upsert lets the index maintenance batch.
 *   5. Records the run in scryfall_sync_runs (bulk_type 'oracle_cards', so the
 *      printings sync's queries, which all filter on bulk_type, never see it).
 *
 * Each chunk is its own autocommitted pair of statements, not one transaction
 * for the whole load: a chunk is idempotent (the staging table is emptied and
 * the upsert is keyed), a dropped connection loses at most the chunk in flight,
 * and the next run re-diffs and writes only what is still outstanding. No
 * retry loop for the same reason: this file is ~25MB and a day is a short time
 * to wait for oracle text that changes a few times a month.
 *
 * Connection: SCRYFALL_SYNC_DATABASE_URL, the session pooler on port 5432 as
 * scryfall_loader.<project-ref> (migration 44), TLS verified. Read HERE and
 * nowhere else -- CLAUDE.md hard constraint 4 and eslint.config.mjs. See
 * scripts/sync-oracle-connection.ts for what is refused and why. Per session:
 * statement_timeout 10min (one chunk should take a second or two, so this only
 * ever fires on something wrong) and lock_timeout 5s (fail fast rather than
 * queue behind a migration's ACCESS EXCLUSIVE lock and stall readers behind us).
 *
 * Usage:
 *   npm run sync:oracle
 *   npm run sync:oracle -- --force
 *
 * Exits non-zero, with a sentence, when the secret is missing or malformed.
 */

import { Readable, pipeline as pipelineCb } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { config as loadEnv } from "dotenv";
import postgres, { type ReservedSql } from "postgres";

import { copyLine } from "../src/lib/pg-copy";
import { SCRYFALL_BULK_INDEX_URL, scryfallHeaders, type ScryfallBulkEntry } from "../src/lib/scryfall";
import {
  ORACLE_BULK_TYPE,
  ORACLE_COLUMNS,
  checkOracleFeedComplete,
  planOracleWrites,
  streamOracleRows,
  type OracleRow,
} from "../src/lib/scryfall-oracle";
import {
  LOADER_LOCK_TIMEOUT,
  LOADER_STATEMENT_TIMEOUT,
  connectionOptions,
} from "./sync-oracle-connection";

// Same convention as sync-scryfall.ts: this runs outside Next, so load env files.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

/** Rows per COPY + upsert. Small enough that one chunk is a second or two of work. */
const CHUNK_SIZE = 2_000;

/** A hung database must not hold the process: cap the write that records a failure. */
const FAIL_WRITE_TIMEOUT_MS = 10_000;

function log(message: string) {
  console.log(`[oracle-sync] ${new Date().toISOString()} ${message}`);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: string } }).cause;
  const code = (error as { code?: string }).code ?? cause?.code;
  return code ? `${error.message} [${code}]` : error.message;
}

/** The run row currently open, visible to the last-resort handlers below. */
let openRun: { db: ReservedSql; runId: number; written: () => number; closed: boolean } | null =
  null;
let failing: Promise<void> | undefined;

async function main() {
  const force = process.argv.slice(2).includes("--force");

  const url = process.env.SCRYFALL_SYNC_DATABASE_URL;
  if (!url) {
    throw new Error(
      "SCRYFALL_SYNC_DATABASE_URL is not set. This is the session-pooler connection string " +
        "for the scryfall_loader role (see migration 44 and .github/workflows/scryfall-sync.yml). " +
        "The scheduled workflow only runs this step when the secret exists; run it by hand " +
        "only with the variable set.",
    );
  }
  const sql = postgres(connectionOptions(url, process.env.SCRYFALL_SYNC_DATABASE_CA || undefined));
  const contact =
    process.env.SCRYFALL_CONTACT || "project-upkeep (https://github.com/atalpak/ProjectUpkeep)";

  try {
    await load(sql, { force, contact });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function load(
  sql: postgres.Sql,
  { force, contact }: { force: boolean; contact: string },
) {
  // ---- 1. Find the export -------------------------------------------------
  log(`fetching bulk-data index for type "${ORACLE_BULK_TYPE}"`);
  const indexResponse = await fetch(SCRYFALL_BULK_INDEX_URL, { headers: scryfallHeaders(contact) });
  if (!indexResponse.ok) {
    throw new Error(
      `Scryfall bulk-data index returned ${indexResponse.status} ${indexResponse.statusText}`,
    );
  }
  const index = (await indexResponse.json()) as { data?: ScryfallBulkEntry[] };
  const entry = index.data?.find((d) => d.type === ORACLE_BULK_TYPE);
  if (!entry) {
    const available = (index.data ?? []).map((d) => d.type).join(", ");
    throw new Error(
      `Scryfall has no bulk export of type "${ORACLE_BULK_TYPE}". Available: ${available}`,
    );
  }
  log(`export updated_at=${entry.updated_at}`);

  // ---- 2. One session, configured before anything else runs ---------------
  // reserve() pins a single connection for the whole run: the staging table
  // and the two `set`s below only exist on the session that made them.
  log("connecting");
  const db = await sql.reserve().catch((error: unknown) => {
    // A pooler certificate chains to Supabase's own CA, which Node does not
    // ship; say what to do rather than leaving a bare TLS error in a CI log.
    const code = (error as { code?: string }).code ?? "";
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
      throw new Error(
        `${describe(error)}. TLS verification failed: supply the database's CA certificate (PEM) ` +
          "as SCRYFALL_SYNC_DATABASE_CA.",
      );
    }
    throw error;
  });
  await db.unsafe(`set statement_timeout = '${LOADER_STATEMENT_TIMEOUT}'`);
  await db.unsafe(`set lock_timeout = '${LOADER_LOCK_TIMEOUT}'`);

  // ---- 3. Skip if upstream has not changed --------------------------------
  const [last] = await db<{ bulk_updated_at: Date | null }[]>`
    select bulk_updated_at
      from public.scryfall_sync_runs
     where bulk_type = ${ORACLE_BULK_TYPE} and status = 'succeeded'
     order by started_at desc
     limit 1`;
  const [{ stored }] = await db<{ stored: number }[]>`
    select count(*)::int as stored from public.oracle_cards`;

  const upToDate =
    last?.bulk_updated_at != null &&
    new Date(last.bulk_updated_at).getTime() === new Date(entry.updated_at).getTime();
  if (upToDate && stored > 0 && !force) {
    log(`already up to date with this export (${stored.toLocaleString()} cards stored); skipping (use --force to override)`);
    await db`
      insert into public.scryfall_sync_runs (bulk_type, bulk_updated_at, status, finished_at)
      values (${ORACLE_BULK_TYPE}, ${entry.updated_at}::timestamptz, 'skipped', now())`;
    return;
  }

  // ---- 4. Open the run ----------------------------------------------------
  const [run] = await db<{ id: number }[]>`
    insert into public.scryfall_sync_runs (bulk_type, bulk_updated_at, status)
    values (${ORACLE_BULK_TYPE}, ${entry.updated_at}::timestamptz, 'running')
    returning id`;
  let written = 0;
  const runId = Number(run.id);
  openRun = { db, runId, written: () => written, closed: false };

  try {
    // ---- 5. Stored fingerprints -------------------------------------------
    const storedRows = await db<{ oracle_id: string; content_hash: string | null }[]>`
      select oracle_id::text, content_hash from public.oracle_cards`;
    const existing = new Map(storedRows.map((r) => [r.oracle_id, r.content_hash]));
    log(`${existing.size.toLocaleString()} stored cards`);

    // Session-local, no indexes, same columns and NOT NULLs as the real table.
    // `on commit` is irrelevant outside a transaction: it lives until the
    // session ends, and is emptied per chunk.
    await db.unsafe("create temp table oracle_stage (like public.oracle_cards including defaults)");

    // ---- 6. Download, map, diff, COPY, upsert -----------------------------
    log(`downloading ${entry.jsonl_download_uri}`);
    const download = await fetch(entry.jsonl_download_uri, { headers: scryfallHeaders(contact) });
    if (!download.ok || !download.body) {
      throw new Error(`Bulk download returned ${download.status} ${download.statusText}`);
    }
    // Served as application/gzip with no content-encoding, so the bytes arrive
    // compressed. pipeline() (not .pipe()) forwards a dropped connection to the
    // gunzip stream as an ordinary error; see sync-scryfall.ts for the incident.
    const jsonl = createGunzip();
    pipelineCb(
      Readable.fromWeb(download.body as Parameters<typeof Readable.fromWeb>[0]),
      jsonl,
      () => {},
    );

    let unchanged = 0;
    const columnList = ORACLE_COLUMNS.join(", ");
    const setList = ORACLE_COLUMNS.filter((c) => c !== "oracle_id")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");

    const writeChunk = async (rows: OracleRow[]) => {
      await db.unsafe("truncate oracle_stage");
      const copy = await db
        .unsafe(`copy oracle_stage (${columnList}) from stdin with (format csv)`)
        .writable();
      await pipeline(
        Readable.from(rows.map((row) => copyLine(ORACLE_COLUMNS.map((c) => row[c])))),
        copy,
      );
      // The WHERE is a second check on the diff above: a row that raced in
      // with the same hash is not rewritten (and its indexes are not touched).
      const result = await db.unsafe(`
        insert into public.oracle_cards (${columnList}, updated_at)
        select ${columnList}, now() from oracle_stage
        on conflict (oracle_id) do update set ${setList}, updated_at = excluded.updated_at
        where public.oracle_cards.content_hash is distinct from excluded.content_hash`);
      written += result.count;
      if (Math.floor(written / 10_000) > Math.floor((written - result.count) / 10_000)) {
        log(`wrote ${written.toLocaleString()} cards...`);
      }
    };

    const result = await streamOracleRows(jsonl, {
      batchSize: CHUNK_SIZE,
      onBatch: async (rows) => {
        const plan = planOracleWrites(rows, existing);
        unchanged += plan.unchanged;
        if (plan.changed.length > 0) await writeChunk(plan.changed);
      },
    });

    // ---- 7. Close the run -------------------------------------------------
    // Before the run is marked succeeded, so a truncated feed can never become
    // the export's `succeeded` row (the next run would then skip it).
    const short = checkOracleFeedComplete(result.processed, existing.size);
    if (short) {
      if (!force) throw new Error(short);
      log(`WARNING: ${short} (continuing because of --force)`);
    }

    await db`
      update public.scryfall_sync_runs
         set status = 'succeeded', cards_upserted = ${written}, finished_at = now()
       where id = ${runId}`;
    openRun.closed = true;

    log(
      `done: ${written.toLocaleString()} cards written, ${unchanged.toLocaleString()} unchanged and left alone` +
        (result.skipped > 0 ? `, ${result.skipped} unusable records skipped` : "") +
        (result.duplicates > 0 ? `, ${result.duplicates} duplicate oracle ids dropped` : ""),
    );
  } catch (error) {
    await failRun(error);
    throw error;
  }
}

/**
 * Marks the open run failed. Never throws (it runs while dying) and is
 * memoised so a SIGTERM racing a thrown error waits for one write, not two.
 */
function failRun(error: unknown): Promise<void> {
  const run = openRun;
  if (!run || run.closed) return Promise.resolve();
  failing ??= (async () => {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    let timer: NodeJS.Timeout | undefined;
    try {
      const write = run.db`
        update public.scryfall_sync_runs
           set status = 'failed', cards_upserted = ${run.written()},
               error_message = ${message}, finished_at = now()
         where id = ${run.runId}`.then(() => undefined);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no response after ${FAIL_WRITE_TIMEOUT_MS / 1000}s`)),
          FAIL_WRITE_TIMEOUT_MS,
        );
      });
      await Promise.race([write, timeout]);
      run.closed = true;
    } catch (writeError) {
      console.error(
        `[oracle-sync] could not record run ${run.runId} as failed (row may be left at 'running'): ` +
          describe(writeError),
      );
    } finally {
      clearTimeout(timer);
    }
  })();
  return failing;
}

async function fatal(error: unknown): Promise<never> {
  console.error(`[oracle-sync] FAILED: ${describe(error)}`);
  await failRun(error);
  process.exit(1);
}

process.on("uncaughtException", (error) => void fatal(error));
process.on("unhandledRejection", (reason) => void fatal(reason));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void fatal(new Error(`Loader interrupted by ${signal}`)));
}

main().catch((error: unknown) => fatal(error));
