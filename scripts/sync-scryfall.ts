/**
 * Scryfall bulk sync.
 *
 * Pulls Scryfall's `default_cards` bulk export and upserts every printing into
 * public.cards. Designed to be run on a schedule (see
 * .github/workflows/scryfall-sync.yml) rather than by hand:
 *
 *   - Idempotent. Upserts on the primary key, so re-running is safe.
 *   - Writes only what changed. Rewriting all ~118,000 rows a day, most of them
 *     identical, is what timed the database write out: every rewrite touches
 *     every index on `cards`. The sync reads the stored per-row fingerprints
 *     (cards.content_hash, migration 42) up front and upserts only new or
 *     changed rows; see src/lib/scryfall-diff.ts. That makes last_synced_at
 *     mean "when this row was last written", and prices_updated_at "when a
 *     price last changed".
 *   - Cheap when nothing changed. Scryfall stamps each export with its own
 *     updated_at; if that matches our last successful run we record a `skipped`
 *     run and exit without downloading ~500MB. Pass --force to override.
 *   - Downloaded first, then streamed, never buffered. The export is far too
 *     large to hold in memory on a free-tier runner, so it is saved to a temp
 *     file before being parsed and upserted in batches.
 *   - Observable. Every run writes a row to public.scryfall_sync_runs with its
 *     status, row count, and any error.
 *   - Reports whether it actually wrote anything via $GITHUB_OUTPUT
 *     (upserted=true|false), when running under Actions. Added so the
 *     publish-a-mobile-catalog step in scryfall-sync.yml can skip a ~30MB
 *     re-publish on a day nothing changed — see that workflow for the
 *     consumer. True means the catalog needs rebuilding: this run wrote a
 *     row the catalog contains (price-only changes do not count, the catalog
 *     has no prices), or an earlier run died after writing, or an earlier
 *     succeeded run's publish was never recorded (scryfall_sync_runs
 *     .catalog_published_at, stamped by publish-catalog.ts), or --force was
 *     given. A skipped run reports the same, since "export unchanged" does
 *     not mean the last publish landed. Otherwise false: the catalog is built
 *     from `cards`, and nothing it contains has changed.
 *
 * Usage:
 *   npm run sync:scryfall
 *   npm run sync:scryfall -- --force
 *   npm run sync:scryfall -- --limit 5000   # for a quick smoke test
 */

import { appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";

import { config as loadEnv } from "dotenv";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SCRYFALL_BULK_INDEX_URL,
  scryfallHeaders,
  type CardRow,
  type ScryfallBulkEntry,
} from "../src/lib/scryfall";
import {
  catalogMayBeStale,
  checkHashReadComplete,
  loadExistingHashes,
  planWrites,
  shouldPublishCatalog,
  type PriorRun,
  type SyncRow,
} from "../src/lib/scryfall-diff";
import { parseContentLength, withDownloadedFile } from "../src/lib/scryfall-download";
import { streamCardRows } from "../src/lib/scryfall-stream";
import { createChunkedWriter } from "../src/lib/scryfall-upsert";
import { isMissingColumnError } from "../src/lib/supabase/errors";
import { withRetry } from "./sync-retry";

// The web app reads .env.local via Next; this script runs outside Next, so load
// it explicitly. .env.local wins, .env is the fallback (what CI usually sets).
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type Args = { force: boolean; limit: number | null };

function parseArgs(argv: string[]): Args {
  const force = argv.includes("--force");
  const limitIndex = argv.indexOf("--limit");
  const limit =
    limitIndex !== -1 && argv[limitIndex + 1]
      ? Number.parseInt(argv[limitIndex + 1], 10)
      : null;

  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit expects a positive integer");
  }
  return { force, limit };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function log(message: string) {
  console.log(`[scryfall-sync] ${new Date().toISOString()} ${message}`);
}

/**
 * Writes a GitHub Actions step output. A silent no-op outside Actions (local
 * runs never set $GITHUB_OUTPUT), so this needs no environment gate at every
 * call site.
 */
async function setActionsOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  await appendFile(file, `${name}=${value}\n`);
}

async function main() {
  const { force, limit } = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const bulkType = process.env.SCRYFALL_BULK_TYPE || "default_cards";
  const batchSize = Number.parseInt(process.env.SCRYFALL_BATCH_SIZE || "500", 10);
  const contact =
    process.env.SCRYFALL_CONTACT || "project-upkeep (https://github.com/atalpak/ProjectUpkeep)";

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("SCRYFALL_BATCH_SIZE must be a positive integer");
  }

  // Service role: `cards` is deliberately unwritable by any end user. This is
  // one of two scripts in the system that bypass RLS this way — see
  // scripts/publish-catalog.ts and .claude/rules/data-access.md for the
  // other, added in the mobile-app initiative's phase 5.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 1. Find the export -------------------------------------------------
  log(`fetching bulk-data index for type "${bulkType}"`);
  const indexResponse = await fetch(SCRYFALL_BULK_INDEX_URL, {
    headers: scryfallHeaders(contact),
  });
  if (!indexResponse.ok) {
    throw new Error(
      `Scryfall bulk-data index returned ${indexResponse.status} ${indexResponse.statusText}`,
    );
  }

  const index = (await indexResponse.json()) as { data?: ScryfallBulkEntry[] };
  const entry = index.data?.find((d) => d.type === bulkType);
  if (!entry) {
    const available = (index.data ?? []).map((d) => d.type).join(", ");
    throw new Error(
      `Scryfall has no bulk export of type "${bulkType}". Available: ${available}`,
    );
  }

  log(
    `export updated_at=${entry.updated_at} size=${
      entry.compressed_size
        ? `${(entry.compressed_size / 1_000_000).toFixed(0)}MB compressed`
        : "unknown"
    }`,
  );

  // ---- 2. Skip if upstream has not changed --------------------------------
  const { data: lastRun, error: lastRunError } = await db
    .from("scryfall_sync_runs")
    .select("id, bulk_updated_at")
    .eq("bulk_type", bulkType)
    .eq("status", "succeeded")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRunError) {
    throw new Error(`Could not read sync history: ${lastRunError.message}`);
  }

  // Did an earlier run write rows and then die before the catalog was rebuilt?
  // Those rows now carry their new hashes, so this run will find nothing to
  // write and would otherwise report "nothing changed" — see catalogMayBeStale.
  // Read before the skip check and before this run opens its own row, so it
  // cannot see itself and a skipped day still republishes a catalog that never landed.
  const { data: sinceSuccess, error: sinceError } = await db
    .from("scryfall_sync_runs")
    .select("id, status, cards_upserted")
    .eq("bulk_type", bulkType)
    .in("status", ["failed", "running"])
    .gt("id", lastRun?.id ?? 0);
  if (sinceError) {
    throw new Error(`Could not read sync history: ${sinceError.message}`);
  }
  // The newest run of ANY status that a catalog publish has been stamped on,
  // skipped ones included. A failed run behind that stamp has been published
  // over; see catalogMayBeStale for why this is the exit from the skip loop.
  const { data: lastPublished, error: lastPublishedError } = await db
    .from("scryfall_sync_runs")
    .select("id")
    .eq("bulk_type", bulkType)
    .not("catalog_published_at", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastPublishedError) {
    throw new Error(
      isMissingColumnError(lastPublishedError.code)
        ? "scryfall_sync_runs.catalog_published_at does not exist. Apply migration 42 " +
            "(supabase db push --linked) before running this sync."
        : `Could not read sync history: ${lastPublishedError.message}`,
    );
  }
  const priorRunUnpublished = catalogMayBeStale(
    (sinceSuccess ?? []) as PriorRun[],
    lastPublished?.id ?? 0,
  );
  if (priorRunUnpublished) {
    log("an earlier run wrote rows without finishing; the catalog will be republished");
  }

  // A succeeded (or skipped) run that needed a catalog publish and never recorded one: the
  // publish step failed (or was cancelled) after a good sync. The catalog is
  // built from `cards`, so publishing now covers whatever that run changed.
  const { data: unpublished, error: unpublishedError } = await db
    .from("scryfall_sync_runs")
    .select("id")
    .eq("bulk_type", bulkType)
    .in("status", ["succeeded", "skipped"])
    .eq("catalog_needs_publish", true)
    .is("catalog_published_at", null)
    .limit(1);
  if (unpublishedError) {
    throw new Error(
      isMissingColumnError(unpublishedError.code)
        ? "scryfall_sync_runs.catalog_needs_publish does not exist. Apply migration 42 " +
            "(supabase db push --linked) before running this sync."
        : `Could not read sync history: ${unpublishedError.message}`,
    );
  }
  const unpublishedEarlier = (unpublished ?? []).length > 0;
  if (unpublishedEarlier) {
    log("an earlier run's catalog was never published; the catalog will be republished");
  }

  const upToDate =
    lastRun?.bulk_updated_at &&
    new Date(lastRun.bulk_updated_at).getTime() === new Date(entry.updated_at).getTime();

  if (upToDate && !force) {
    log("already up to date with this export; skipping download (use --force to override)");
    await db.from("scryfall_sync_runs").insert({
      bulk_type: bulkType,
      bulk_updated_at: entry.updated_at,
      status: "skipped",
      // A skipped day that publishes because an earlier run died after writing
      // says so on its own row, so the publish step stamps THIS row and the
      // failed one is behind a stamp from then on. Without it nothing would
      // ever clear the failure, and every later skipped day would republish.
      catalog_needs_publish: priorRunUnpublished,
      finished_at: new Date().toISOString(),
    });
    // Nothing to sync, but a catalog that never landed still has to.
    await setActionsOutput(
      "upserted",
      shouldPublishCatalog({
        catalogChanged: 0,
        priorRunIncomplete: priorRunUnpublished,
        unpublishedEarlier,
        force: false,
      })
        ? "true"
        : "false",
    );
    return;
  }

  // ---- 3. Open the run ----------------------------------------------------
  const { data: run, error: runError } = await db
    .from("scryfall_sync_runs")
    .insert({ bulk_type: bulkType, bulk_updated_at: entry.updated_at, status: "running" })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(`Could not open a sync run: ${runError?.message ?? "no row returned"}`);
  }

  const runId = run.id as number;
  const syncedAt = new Date().toISOString();

  // `upserted` counts rows actually written and is NOT reset between attempts:
  // a retry re-reads the stored hashes, so rows the failed pass already wrote
  // are skipped as unchanged rather than written twice, and resetting would
  // lose them — a run that wrote 90,000 rows before a dropped connection could
  // then finish "with nothing to publish". The other two are per pass, because
  // a retry starts the download over and would count them twice.
  let upserted = 0;
  // Rows written that the mobile catalog can see, i.e. everything except
  // price-only changes. Also kept across attempts, for the same reason.
  let catalogChanged = 0;
  let unchanged = 0;
  let skippedRecords = 0;

  // Visible to the last-resort handlers below, which run outside this function.
  openRun = { db, runId, upserted: () => upserted, closed: false };

  try {
    // ---- 4. Stream, map, batch-upsert -------------------------------------
    // Retried only for a dropped connection; see scripts/sync-retry.ts for why
    // a database error is deliberately not. The budget keeps the retries inside
    // the workflow's 45-minute timeout, which also has to cover npm ci and the
    // catalog steps that follow.
    await withRetry(
      async (attempt) => {
        unchanged = 0;
        skippedRecords = 0;
        await runPass(attempt);
      },
      {
        budgetMs: RETRY_BUDGET_MS,
        onRetry: ({ attempt, nextAttempt, waitMs, error }) =>
          log(
            `attempt ${attempt} failed with a network error (${describe(error)}); ` +
              `retrying from the start as attempt ${nextAttempt} in ${waitMs / 1000}s`,
          ),
        onGiveUp: ({ attempt, reason, error }) =>
          log(`giving up after attempt ${attempt}: ${reason} (${describe(error)})`),
      },
    );
  } catch (error) {
    // Record the failure before rethrowing, so a scheduled run that dies leaves
    // evidence in the table rather than only in a CI log that ages out.
    await failRun(error);
    throw error;
  }

  async function runPass(attempt: number) {
    // Up front, before the download: a database without migration 42 should
    // fail here, in seconds, not after streaming half a gigabyte.
    log("reading stored card fingerprints");
    const existing = await loadExistingHashes(async (after, size) => {
      let query = db
        .from("cards")
        .select("scryfall_id, content_hash")
        .order("scryfall_id", { ascending: true })
        .limit(size);
      if (after !== null) query = query.gt("scryfall_id", after);
      const { data, error } = await query;
      if (error && isMissingColumnError(error.code)) {
        throw new Error(
          "cards.content_hash does not exist. Apply migration 42 " +
            "(supabase db push --linked) before running this sync.",
        );
      }
      return {
        rows: (data ?? []) as { scryfall_id: string; content_hash: string | null }[],
        error,
      };
    });
    log(`${existing.size.toLocaleString()} stored printings`);

    // A short read would turn into a silent full rewrite; see the guard.
    const { count: tableCount, error: countError } = await db
      .from("cards")
      .select("scryfall_id", { count: "exact", head: true });
    if (countError) throw new Error(`Could not count cards: ${countError.message}`);
    const shortRead = checkHashReadComplete(existing.size, tableCount ?? 0);
    if (shortRead) {
      if (!force) throw new Error(shortRead);
      log(`WARNING: ${shortRead} (continuing because of --force)`);
    }

    log(`downloading ${entry!.jsonl_download_uri} (attempt ${attempt})`);
    await withDownloadedFile(
      async () => {
        const download = await fetch(entry!.jsonl_download_uri, {
          headers: scryfallHeaders(contact),
        });
        if (!download.ok || !download.body) {
          throw new Error(`Bulk download returned ${download.status} ${download.statusText}`);
        }
        return {
          body: download.body,
          expectedBytes: parseContentLength(download.headers.get("content-length")),
        };
      },
      async (file, info) => {
        log(
          `downloaded ${(info.bytes / 1_000_000).toFixed(0)}MB in ` +
            `${(info.ms / 1000).toFixed(1)}s; upserting from disk`,
        );
        await upsertDownloadedFile(file, existing);
      },
      {
        onCleanupError: (error, dir) =>
          log(`could not remove temp download ${dir}: ${describe(error)}`),
      },
    );
  }

  async function upsertDownloadedFile(file: string, existing: Map<string, string | null>) {
    // The export is served as application/gzip with no content-encoding header,
    // so the file holds the compressed bytes as-is. Decompress from disk and
    // keep the existing streaming parser and diff-aware batch writer.
    const cards = createGunzip();
    pipeline(createReadStream(file), cards, () => {});

    // A statement timeout used to fail the whole run — see scryfall-upsert.ts.
    // Now it halves the chunk, keeps the smaller size, and carries on.
    const writer = createChunkedWriter<SyncRow>({
      startSize: batchSize,
      write: async (rows) => {
        // Upsert on the primary key: new printings insert, existing ones
        // refresh. Each call is homogeneous (planWrites keeps rows with and
        // without prices_updated_at apart), so the column list PostgREST
        // derives from the batch is right for every row in it. Awaited rather than returned: the query builder is a
        // thenable, not a promise, and the writer wants a settled result.
        const { error } = await db
          .from("cards")
          .upsert(rows, { onConflict: "scryfall_id", ignoreDuplicates: false });
        return { error };
      },
      onNotice: log,
      onWritten: (written) => {
        const before = upserted;
        upserted += written.length;
        for (const row of written) {
          if (!priceOnlyIds.has(row.scryfall_id)) catalogChanged += 1;
        }
        if (Math.floor(upserted / 25_000) > Math.floor(before / 25_000)) {
          log(`upserted ${upserted.toLocaleString()} printings...`);
        }
      },
    });
    // Which ids in the batch being written changed only in price; set per batch.
    let priceOnlyIds: ReadonlySet<string> = new Set();

    const upsertBatch = async (rows: CardRow[]) => {
      const plan = planWrites(rows, existing);
      unchanged += plan.unchanged;
      priceOnlyIds = plan.priceOnly;

      // Counting happens per chunk, in the writer's onWritten callback, not
      // here after the fact: if a later chunk of this batch throws, the chunks
      // before it are already in the database, and the failed run's count and
      // the retry's view of "what did I write" both have to include them.
      await writer.write(plan.full);
      await writer.write(plan.metaOnly);
    };

    const result = await streamCardRows(cards, {
      batchSize,
      syncedAt,
      limit,
      onBatch: upsertBatch,
    });

    skippedRecords = result.skipped;
    if (result.stoppedEarly) log(`--limit ${limit} reached; stopped early`);

    // ---- 5. Close the run -------------------------------------------------
    // Decided before the row closes so it is recorded with it. Stored as
    // catalog_needs_publish, and cleared by publish-catalog.ts only once the
    // upload succeeds — that is what lets a later run see a publish that never
    // landed. Deliberately just this run's own reason to publish, not the
    // earlier-unpublished flag: those earlier rows are still unmarked and keep
    // the demand alive on their own until a publish succeeds.
    const publish = shouldPublishCatalog({
      catalogChanged,
      priorRunIncomplete: priorRunUnpublished,
      unpublishedEarlier,
      force,
    });
    const { error: closeError } = await db
      .from("scryfall_sync_runs")
      .update({
        status: "succeeded",
        cards_upserted: upserted,
        catalog_needs_publish: catalogChanged > 0 || priorRunUnpublished || force,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (openRun) openRun.closed = true;
    if (closeError) {
      // The data landed, so this is not a failed run and the output below is
      // still emitted. But the row will read `running` — say so, loudly.
      console.error(
        `[scryfall-sync] WARNING: sync succeeded but run ${runId} could not be marked ` +
          `succeeded (row may be left at 'running'): ${closeError.message}`,
      );
    }

    log(
      `done: ${upserted.toLocaleString()} printings upserted, ` +
        `${unchanged.toLocaleString()} unchanged and left alone` +
        (skippedRecords > 0 ? `, ${skippedRecords} unusable records skipped` : "") +
        // Worth saying out loud: a run that needed splitting still succeeded,
        // but it is the early warning that the table is outgrowing the
        // statement timeout, and it will show up here before it fails again.
        (writer.splits() > 0
          ? `, ${writer.splits()} chunk(s) split after a timeout (ended at ${writer.chunkSize()} rows)`
          : "") +
        (writer.retries() > 0 ? `, ${writer.retries()} write(s) retried` : ""),
    );
    // Only after the run is closed as succeeded, and only once however many
    // attempts it took: the catalog steps gate on this being exactly `true`.
    // Gated on what the catalog actually contains, not on "any row written":
    // the catalog carries no prices, so a day of price-only changes has nothing
    // to publish. Republish also when an earlier run died after writing (its
    // rows are already stored, so this run cannot see them as changes), and on
    // --force, so a forced run can always republish.
    await setActionsOutput("upserted", publish ? "true" : "false");
  }
}

/**
 * The run row currently open, if any. Module state because the last-resort
 * handlers (uncaught exception, SIGTERM from a cancelled or timed-out job) fire
 * outside main() and still need to leave the row in a terminal state.
 */
let openRun: {
  db: SupabaseClient;
  runId: number;
  upserted: () => number;
  closed: boolean;
  /** The one in-flight failure write, shared by every caller of failRun(). */
  failing?: Promise<void>;
} | null = null;

/** supabase-js has no request timeout; a hung database must not hold the process. */
const FAIL_WRITE_TIMEOUT_MS = 10_000;

/**
 * Marks the open run failed. Never throws: it runs while dying.
 *
 * Memoised, not just guarded by a flag: a second fatal() (SIGINT then SIGTERM,
 * or an uncaught exception then an unhandled rejection) must wait for the
 * first write to settle, not return early and process.exit() with it in flight.
 */
function failRun(error: unknown): Promise<void> {
  const run = openRun;
  if (!run || run.closed) return Promise.resolve();
  run.failing ??= writeFailure(run, error);
  return run.failing;
}

async function writeFailure(run: NonNullable<typeof openRun>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let timer: NodeJS.Timeout | undefined;
  try {
    const write = (async () => {
      const { error: writeError } = await run.db
        .from("scryfall_sync_runs")
        .update({
          status: "failed",
          cards_upserted: run.upserted(),
          error_message: message.slice(0, 2000),
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.runId);
      if (writeError) throw new Error(writeError.message);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no response after ${FAIL_WRITE_TIMEOUT_MS / 1000}s`)),
        FAIL_WRITE_TIMEOUT_MS,
      );
    });
    await Promise.race([write, timeout]);
    run.closed = true;
  } catch (writeFailure) {
    // The database is the likeliest reason the run failed at all. Say plainly
    // that the row is stuck at `running` so nobody trusts it.
    console.error(
      `[scryfall-sync] could not record run ${run.runId} as failed ` +
        `(row may be left at 'running'): ` +
        `${writeFailure instanceof Error ? writeFailure.message : String(writeFailure)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One line for a log: the message plus the underlying code, which undici hides. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ? `${error.message} [${cause.code}]` : error.message;
}

// The retries plus the passes themselves have to leave room in the workflow's
// 45-minute timeout for `npm ci` and the catalog steps after the sync.
const RETRY_BUDGET_MS = 30 * 60 * 1000;

async function fatal(error: unknown): Promise<never> {
  console.error(`[scryfall-sync] FAILED: ${describe(error)}`);
  await failRun(error);
  // Exit rather than set exitCode: after an uncaught stream error other handles
  // may still be open, and a hung process would sit until the job timeout.
  process.exit(1);
}

// Safety nets for anything that escapes main(): an emitter error with no
// listener, a rejected promise nobody awaited. Before these, such a crash
// skipped the catch inside main() and left the run at `running`.
process.on("uncaughtException", (error) => void fatal(error));
process.on("unhandledRejection", (reason) => void fatal(reason));
// GitHub sends SIGINT then SIGTERM when a job is cancelled or times out.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void fatal(new Error(`Sync interrupted by ${signal}`)));
}

main().catch((error: unknown) => fatal(error));
