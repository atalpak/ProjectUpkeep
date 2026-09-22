/**
 * Catalog export.
 *
 * Pages through `public.cards` over PostgREST and writes JSONL that
 * `packages/scan-core/scripts/build-catalog.ts` already knows how to read —
 * this is the "existing Upkeep cards sync/export" that script's own header
 * comment refers to, which never actually existed until now.
 *
 * Lives at the repo root, next to `sync-scryfall.ts`, rather than under
 * `packages/scan-core/scripts/` (where a prototype `export-catalog.sql` sat
 * unused): every script that reads a Supabase credential from `process.env`
 * at the top level lives in this one directory, which is what makes "which
 * scripts read a privileged key" a claim you can verify by reading a
 * filenames list instead of auditing every module for what it imports. This
 * script itself only ever reads the ANON key — `cards` already grants
 * `select` to `anon` (migration 3) — but `publish-catalog.ts`, added
 * alongside it, is the second legitimate reader of the service-role key (see
 * `.claude/rules/data-access.md`), and belongs next to this one for the same
 * reason.
 *
 * Previous prototype (`packages/scan-core/scripts/export-catalog.sql`, now
 * deleted) selected `id` from `public.cards`; that column has never existed —
 * the primary key is `scryfall_id` (migration 3) — so the file had never
 * actually been run against the real schema. This version also adds
 * `card_faces` (migration 7), which the fuzzy matcher in
 * `packages/scan-core/scripts/build-catalog.ts` already reads out of every
 * row but which the old export never selected, and `set_name`/`released_at`/
 * `rarity`, which the printing picker needs to show something more useful
 * than a raw set code (see `Printing`'s new optional fields).
 *
 * Usage:
 *   npx tsx scripts/export-catalog.ts cards.jsonl [limit]
 */

import { writeFile, rename } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

import { collectAllRows, type CardRow } from "./export-catalog-paging";

// Same load order as sync-scryfall.ts: .env.local wins for local/manual runs,
// .env is the CI fallback. This script is not part of the Next build, so it
// has to load its own env explicitly.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const [output, limitArg] = process.argv.slice(2);
if (!output) {
  throw new Error("Usage: npx tsx scripts/export-catalog.ts <output.jsonl> [limit]");
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

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
// Deliberately the anon key, not the service role key: reading `cards` needs
// no elevated privilege, and this script's whole reason for living at the
// repo root next to `sync-scryfall.ts` is that credential level is visible
// from the filename, not from having to read the body.
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const PAGE_SIZE = 1000;
// Optional second argument, for smoke runs against the live database.
const LIMIT = limitArg === undefined ? undefined : Number(limitArg);
// A typo here must not quietly turn a smoke run into a full 100k-row export.
if (LIMIT !== undefined && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
  throw new Error(
    `Invalid limit "${limitArg}": expected a positive integer. ` +
      "Usage: npx tsx scripts/export-catalog.ts <output.jsonl> [limit]",
  );
}

// Every row this export selects. `scryfall_id` is mapped to the JSON key
// `id` below, since `build-catalog.ts` and `Printing.id` both already expect
// that name — Scryfall's own printing UUID, used directly as our PK.
const COLUMNS = [
  "scryfall_id",
  "oracle_id",
  "name",
  "flavor_name",
  "set_code",
  "set_name",
  "collector_number",
  "available_finishes",
  "lang",
  "image_uri",
  "digital",
  "card_faces",
  "layout",
  "set_type",
  "released_at",
  "rarity",
].join(",");

/**
 * Layouts that are never something a user scans or sleeves: tokens, emblems
 * and Scryfall's art-series reprints (e.g. Unfinity's gallery cards) are real
 * rows in `cards` but not physical decklist-eligible cardboard as this app
 * understands it. `memorabilia`-typed sets (oversized/novelty items) are
 * filtered the same way, by `set_type` rather than `layout`, since a
 * memorabilia set can otherwise carry a `normal` layout.
 *
 * Kept as one clearly-commented filter so it is easy to revisit — the list of
 * "noise" layouts Scryfall uses has grown before and will again.
 */
const EXCLUDED_LAYOUTS = ["token", "double_faced_token", "emblem", "art_series"];
const EXCLUDED_SET_TYPES = ["memorabilia"];

function log(message: string) {
  console.log(`[export-catalog] ${new Date().toISOString()} ${message}`);
}

async function main() {
  const db = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Keyset paging, not `.range(offset)`: see export-catalog-paging.ts for why
  // offset paging timed out at ~58,000 rows. `.gt` on the primary key plus the
  // same `order by scryfall_id` makes each page an index seek.
  const rows = await collectAllRows(
    async (after) => {
      let query = db
        .from("cards")
        .select(COLUMNS)
        .eq("digital", false)
        .not("oracle_id", "is", null)
        // `not.in.(...)` on its own would silently drop rows with a null
        // layout/set_type too — SQL's `NULL NOT IN (...)` is NULL, not true,
        // so it fails the WHERE clause. Explicitly OR in the null case so an
        // unbackfilled row (layout/set_type only exist since migration 7) is
        // kept rather than quietly excluded from the bundle.
        .or(`layout.not.in.(${EXCLUDED_LAYOUTS.join(",")}),layout.is.null`)
        .or(`set_type.not.in.(${EXCLUDED_SET_TYPES.join(",")}),set_type.is.null`)
        .order("scryfall_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (after !== null) query = query.gt("scryfall_id", after);

      const { data, error } = await query;
      if (error) {
        // PostgREST errors are plain objects, not `Error`s; wrap so the
        // message says where it stopped, and carry `code` across so the
        // pager can still recognise a statement timeout (57014).
        throw Object.assign(
          new Error(`PostgREST read failed after ${after ?? "the start"}: ${error.message}`),
          { code: error.code },
        );
      }
      // Passing a plain comma-separated column list to `.select` (rather than a
      // typed schema generic, which this untyped anon-key client deliberately
      // has none of) leaves supabase-js unable to infer a row shape stronger
      // than an error type; `unknown` is the honest cast, matched by the
      // per-field `String(...)` coercions in export-catalog and build-row.
      return (data ?? []) as unknown as CardRow[];
    },
    {
      pageSize: PAGE_SIZE,
      onProgress: (n) => log(`fetched ${n.toLocaleString()} rows...`),
      onRetry: ({ after, retry, waitMs, error }) =>
        log(
          `page after ${after ?? "start"} timed out (${(error as Error).message}); ` +
            `retry ${retry} in ${waitMs / 1000}s`,
        ),
      ...(LIMIT !== undefined ? { limit: LIMIT } : {}),
    },
  );

  const lines = rows.map((row) => {
    const { scryfall_id, ...rest } = row;
    return JSON.stringify({ id: scryfall_id, ...rest });
  });

  // Write-then-rename, same as build-catalog.ts: a reader never sees a
  // half-written file.
  await writeFile(output + ".next", lines.join("\n") + "\n");
  await rename(output + ".next", output);
  log(`wrote ${rows.length.toLocaleString()} rows to ${output}`);
}

main().catch((error: unknown) => {
  console.error(
    `[export-catalog] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
