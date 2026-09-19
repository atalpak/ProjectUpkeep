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
