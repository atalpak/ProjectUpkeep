/**
 * One-off: create the public Storage bucket `publish-catalog.ts` uploads to.
 *
 * This is a script, not a numbered migration, on purpose: `npm run test:db`
 * (`scripts/verify-migrations.sh`) applies every migration to a throwaway
 * Postgres that has no `storage` schema at all — Supabase Storage is a
 * separate service, provisioned per-project, not something `supabase db
 * reset`/a migration file touches. A migration that referenced
 * `storage.buckets` would break CI for a table CI's Postgres container never
 * has. Run this once per Supabase project, by hand:
 *
 *   npx tsx scripts/create-catalog-bucket.ts
 *
 * It is idempotent (checks for the bucket before creating it), so re-running
 * it against a project that already has the bucket is a no-op, not an error.
 *
 * The bucket is public: the mobile app downloads the catalog unauthenticated
 * (`EXPO_PUBLIC_CATALOG_URL`, fetched with no Supabase client at all — see
 * `apps/mobile/src/catalog.ts`), the same way it already treats the catalog
 * as public card metadata mirrored from Scryfall, not user data.
 */

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

// Shared with publish-catalog.ts, which uploads into this bucket. Kept as a
// literal in both files rather than a shared constant module: two one-off
// scripts agreeing on a name by inspection is simpler than adding an import
// graph for a value that changes approximately never.
const BUCKET = "catalog";

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Service role: bucket administration is not something RLS or the anon key
  // can do, and (per CLAUDE.md hard constraint 4) this script lives in
  // `scripts/`, outside the Next build, for exactly that reason — it is the
  // second legitimate reader of this key, alongside `sync-scryfall.ts`.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: listError } = await db.storage.listBuckets();
  if (listError) throw new Error(`Could not list buckets: ${listError.message}`);
  if (existing?.some((b) => b.name === BUCKET)) {
    console.log(`[create-catalog-bucket] "${BUCKET}" already exists; nothing to do`);
    return;
  }

  const { error: createError } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "50MB", // catalog bundles are budgeted to 40MB; a little headroom.
  });
  if (createError) throw new Error(`Could not create bucket "${BUCKET}": ${createError.message}`);
  console.log(`[create-catalog-bucket] created public bucket "${BUCKET}"`);
}

main().catch((error: unknown) => {
  console.error(
    `[create-catalog-bucket] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
