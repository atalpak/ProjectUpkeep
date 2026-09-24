/**
 * Publishes a built catalog bundle (from `catalog:build`) to Supabase
 * Storage, at a versioned, never-overwritten path.
 *
 * Uses the service-role key, not the anon key: the `catalog` bucket is
 * public to read but Storage write access is not something the anon key
 * carries by default and should not need to. This is the second legitimate
 * reader of `SUPABASE_SERVICE_ROLE_KEY` in this codebase, alongside
 * `sync-scryfall.ts` — both live at the repo root under `scripts/`, outside
 * the Next build, per CLAUDE.md hard constraint 4.
 *
 * The path is `catalog/v1/catalog-<hash>.json`, not a fixed filename: the
 * mobile app's `MIGRATION.md`/version-checking logic (and simple good sense
 * for a CDN-fronted static asset) wants to compare *versions*, which is not
 * possible if every publish overwrites the same object. `<hash>` is the
 * first 16 hex characters of the bundle's own SHA-256 — stable for identical
 * content (a re-publish of an unchanged bundle reuses the same object rather
 * than growing the bucket) and independent of clock skew, unlike a
 * timestamp.
 *
 * After a successful upload it also stamps `catalog_published_at` on the sync
 * runs that were waiting on a publish (migration 42), through the same
 * service-role client — which is why the marker lives here rather than in a
 * third script that would need the key.
 *
 * Usage:
 *   npx tsx scripts/publish-catalog.ts /tmp/catalog-v1.json
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

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

// Matches scripts/create-catalog-bucket.ts's BUCKET constant — see that
// file's comment for why the two are not sharing one module.
const BUCKET = "catalog";

async function main(bundlePath: string) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const bytes = await readFile(bundlePath);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `v1/catalog-${hash}.json`;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/json",
    // Content-addressed path: identical bytes always produce the same path,
    // so re-uploading an unchanged bundle is a safe, cheap no-op overwrite
    // rather than an error.
    upsert: true,
  });
  if (error) {
    throw new Error(`Upload to "${BUCKET}/${path}" failed: ${error.message}`);
  }

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[publish-catalog] uploaded ${bytes.length.toLocaleString()} bytes to ${BUCKET}/${path}`);
  console.log(`[publish-catalog] public URL: ${data.publicUrl}`);

  // The pointer the mobile app checks for updates. Written only AFTER the
  // catalog itself is up, so it can never name a file that is not there yet.
  // Unlike the catalog it lives at a FIXED path and is overwritten each time,
  // which is the whole point: the app cannot know the newest hashed name, but
  // it can always ask this one address for it. Kept short-cached so a fresh
  // publish reaches phones within minutes rather than after the CDN default.
  const parsed = JSON.parse(bytes.toString("utf8")) as { version?: unknown; generatedAt?: unknown };
  if (typeof parsed.version !== "string" || typeof parsed.generatedAt !== "string") {
    throw new Error("Bundle has no version/generatedAt; refusing to publish a latest.json for it.");
  }
  const latest = {
    version: parsed.version,
    generatedAt: parsed.generatedAt,
    bytes: bytes.length,
    url: data.publicUrl,
  };
  const { error: latestError } = await db.storage
    .from(BUCKET)
    .upload("v1/latest.json", JSON.stringify(latest), { contentType: "application/json", upsert: true, cacheControl: "300" });
  if (latestError) throw new Error(`Upload of "${BUCKET}/v1/latest.json" failed: ${latestError.message}`);
  console.log(`[publish-catalog] latest.json now points at ${parsed.version}`);

  // Record that the catalog landed, so the next sync does not have to guess.
  // Only reached after both uploads succeeded. It marks every succeeded (or
  // skipped) sync run still waiting on a publish, not just the latest: the
  // bundle was built from `cards` as it stands now, which contains what all of
  // them wrote.
  //
  // That is only true because sync, export, build and publish run as steps of
  // ONE job (.github/workflows/scryfall-sync.yml), under the `scryfall-sync`
  // concurrency group, so no sync can write between the export and this stamp
  // and no run can be stamped whose rows the bundle never saw. Run this from
  // anywhere else — a second workflow, a laptop while a sync is in flight —
  // and the stamp would be wrong: it could mark a run published whose changes
  // are not in the bundle. Change the workflow shape, change this.
  // Best-effort: the publish itself succeeded, so failing the step here would
  // be wrong. The cost of a missed mark is one redundant republish tomorrow.
  const { error: markError } = await db
    .from("scryfall_sync_runs")
    .update({ catalog_published_at: new Date().toISOString() })
    // Oracle loads share this table (migration 44) but never feed the catalog
    // and never set catalog_needs_publish; excluded by name anyway so that can
    // not become a way for them to be stamped.
    .neq("bulk_type", "oracle_cards")
    .in("status", ["succeeded", "skipped"])
    .eq("catalog_needs_publish", true)
    .is("catalog_published_at", null);
  if (markError) {
    // A GitHub Actions annotation, so a stamp that keeps failing shows up on
    // the run summary instead of only in a log nobody opens — while still not
    // failing a step whose upload succeeded. (Harmless text outside Actions.)
    console.log(
      `::warning title=Catalog published but not recorded::${markError.message}. ` +
        `The next sync will republish the catalog until this stamp succeeds.`,
    );
    console.error(
      `[publish-catalog] WARNING: published, but could not record it in scryfall_sync_runs ` +
        `(the next sync will republish): ${markError.message}`,
    );
  }
}

const [bundlePath] = process.argv.slice(2);
if (!bundlePath) {
  throw new Error("Usage: npx tsx scripts/publish-catalog.ts <bundle.json>");
}

main(bundlePath).catch((error: unknown) => {
  console.error(
    `[publish-catalog] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
