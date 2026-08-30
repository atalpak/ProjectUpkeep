/**
 * Scryfall bulk sync.
 *
 * Pulls Scryfall's `default_cards` bulk export and upserts every printing into
 * public.cards. Designed to be run on a schedule (see
 * .github/workflows/scryfall-sync.yml) rather than by hand:
 *
 *   - Idempotent. Upserts on the primary key, so re-running is a no-op beyond
 *     refreshing last_synced_at.
 *   - Cheap when nothing changed. Scryfall stamps each export with its own
 *     updated_at; if that matches our last successful run we record a `skipped`
 *     run and exit without downloading ~500MB. Pass --force to override.
 *   - Streamed, never buffered. The export is far too large to hold in memory
 *     on a free-tier runner, so it is parsed as a stream and upserted in
 *     batches.
 *   - Observable. Every run writes a row to public.scryfall_sync_runs with its
 *     status, row count, and any error.
 *
 * Usage:
 *   npm run sync:scryfall
 *   npm run sync:scryfall -- --force
 *   npm run sync:scryfall -- --limit 5000   # for a quick smoke test
 */

import { config as loadEnv } from "dotenv";

import { createClient } from "@supabase/supabase-js";
import {
  SCRYFALL_BULK_INDEX_URL,
  scryfallHeaders,
  type CardRow,
  type ScryfallBulkEntry,
} from "../src/lib/scryfall";
import { streamCardRows } from "../src/lib/scryfall-stream";

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

async function main() {
  const { force, limit } = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const bulkType = process.env.SCRYFALL_BULK_TYPE || "default_cards";
  const batchSize = Number.parseInt(process.env.SCRYFALL_BATCH_SIZE || "500", 10);
  const contact =
    process.env.SCRYFALL_CONTACT || "mtgmanager (https://github.com/atalpak/MTGManager)";

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("SCRYFALL_BATCH_SIZE must be a positive integer");
  }

  // Service role: `cards` is deliberately unwritable by any end user, so the
  // sync is the one thing in the system that bypasses RLS.
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
      entry.size ? `${(entry.size / 1_000_000).toFixed(0)}MB` : "unknown"
    }`,
  );

  // ---- 2. Skip if upstream has not changed --------------------------------
  const { data: lastRun, error: lastRunError } = await db
    .from("scryfall_sync_runs")
    .select("bulk_updated_at")
    .eq("bulk_type", bulkType)
    .eq("status", "succeeded")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRunError) {
    throw new Error(`Could not read sync history: ${lastRunError.message}`);
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
      finished_at: new Date().toISOString(),
    });
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

  let upserted = 0;
  let skippedRecords = 0;

  try {
    // ---- 4. Stream, map, batch-upsert -------------------------------------
    log(`downloading ${entry.download_uri}`);
    const download = await fetch(entry.download_uri, { headers: scryfallHeaders(contact) });
    if (!download.ok || !download.body) {
      throw new Error(`Bulk download returned ${download.status} ${download.statusText}`);
    }

    const upsertBatch = async (rows: CardRow[]) => {
      // Upsert on the primary key: new printings insert, existing ones refresh.
      const { error } = await db
        .from("cards")
        .upsert(rows, { onConflict: "scryfall_id", ignoreDuplicates: false });
      if (error) {
        throw new Error(`Upsert of ${rows.length} cards failed: ${error.message}`);
      }
      const before = upserted;
      upserted += rows.length;
      if (Math.floor(upserted / 25_000) > Math.floor(before / 25_000)) {
        log(`upserted ${upserted.toLocaleString()} printings...`);
      }
    };

    const result = await streamCardRows(download.body, {
      batchSize,
      syncedAt,
      limit,
      onBatch: upsertBatch,
    });

    skippedRecords = result.skipped;
    if (result.stoppedEarly) log(`--limit ${limit} reached; stopped early`);

    // ---- 5. Close the run -------------------------------------------------
    await db
      .from("scryfall_sync_runs")
      .update({
        status: "succeeded",
        cards_upserted: upserted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    log(
      `done: ${upserted.toLocaleString()} printings upserted` +
        (skippedRecords > 0 ? `, ${skippedRecords} unusable records skipped` : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Record the failure before rethrowing, so a scheduled run that dies leaves
    // evidence in the table rather than only in a CI log that ages out.
    await db
      .from("scryfall_sync_runs")
      .update({
        status: "failed",
        cards_upserted: upserted,
        error_message: message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(
    `[scryfall-sync] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
