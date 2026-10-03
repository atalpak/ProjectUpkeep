/**
 * Load Scryfall's oracle_tags and rulings bulk feeds over the same verified
 * session-pooler connection as the Oracle loader. Each feed stages completely
 * and passes count checks before one transaction updates its public tables.
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { config as loadEnv } from "dotenv";
import postgres, { type ReservedSql } from "postgres";
import { parser } from "stream-json/jsonl/Parser";

import { copyLine } from "../src/lib/pg-copy";
import {
  checkAuxiliaryFeedSize,
  toOracleRuling,
  toOracleTag,
} from "../src/lib/scryfall-auxiliary";
import { SCRYFALL_BULK_INDEX_URL, scryfallHeaders, type ScryfallBulkEntry } from "../src/lib/scryfall";
import {
  LOADER_LOCK_TIMEOUT,
  LOADER_STATEMENT_TIMEOUT,
  connectionOptions,
} from "./sync-oracle-connection";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type Feed = "oracle_tags" | "rulings";
const MIN_TAGS = 3_000;
const MIN_TAGGINGS = 100_000;
const MIN_RULINGS = 50_000;

function log(message: string) {
  console.log(`[auxiliary-sync] ${new Date().toISOString()} ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function streamFeed(entry: ScryfallBulkEntry, contact: string, onRow: (value: unknown) => void) {
  const response = await fetch(entry.jsonl_download_uri, { headers: scryfallHeaders(contact) });
  if (!response.ok || !response.body) {
    throw new Error(`Bulk download returned ${response.status} ${response.statusText}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createGunzip(),
    parser(),
    async function consume(records: AsyncIterable<{ value: unknown }>) {
      for await (const { value } of records) onRow(value);
    },
  );
}

async function copyRows(db: ReservedSql, table: string, columns: string, lines: string[]) {
  const copy = await db.unsafe(`copy ${table} (${columns}) from stdin with (format csv)`).writable();
  await pipeline(Readable.from(lines), copy);
}

async function stageTags(db: ReservedSql, entry: ScryfallBulkEntry, contact: string) {
  const tagLines: string[] = [];
  const linkLines: string[] = [];
  const seen = new Set<string>();
  const slugs = new Set<string>();
  await streamFeed(entry, contact, (value) => {
    const tag = toOracleTag(value);
    if (seen.has(tag.id) || slugs.has(tag.slug)) throw new Error("Duplicate tag ID or slug in oracle_tags feed");
    seen.add(tag.id);
    slugs.add(tag.slug);
    tagLines.push(copyLine([
      tag.id, tag.label, tag.slug, tag.description, tag.uri,
      tag.aliases, tag.parent_ids, tag.child_ids,
    ]));
    for (const tagging of tag.taggings) {
      linkLines.push(copyLine([tag.id, tagging.oracle_id, tagging.weight]));
    }
  });

  const [{ tags, links }] = await db<{ tags: number; links: number }[]>`
    select
      (select count(*)::int from public.oracle_tags) tags,
      (select count(*)::int from public.oracle_tag_cards) links`;
  checkAuxiliaryFeedSize("oracle_tags", tagLines.length, tags, MIN_TAGS);
  checkAuxiliaryFeedSize("oracle_tag_cards", linkLines.length, links, MIN_TAGGINGS);

  await db.unsafe("create temp table oracle_tags_stage (like public.oracle_tags including defaults)");
  await db.unsafe("create temp table oracle_tag_cards_stage (like public.oracle_tag_cards)");
  await copyRows(db, "oracle_tags_stage", "id,label,slug,description,uri,aliases,parent_ids,child_ids", tagLines);
  await copyRows(db, "oracle_tag_cards_stage", "tag_id,oracle_id,weight", linkLines);
  await db.unsafe("analyze oracle_tags_stage");
  await db.unsafe("analyze oracle_tag_cards_stage");
  const linked = linkLines.length;
  tagLines.length = 0;
  linkLines.length = 0;

  await db.unsafe("begin");
  try {
    // Delete retired tags first so a slug reused by a new UUID is harmless.
    await db.unsafe(`
      delete from public.oracle_tags t
      where not exists (select 1 from oracle_tags_stage s where s.id=t.id)`);
    const metadata = await db.unsafe(`
      insert into public.oracle_tags
        (id,label,slug,description,uri,aliases,parent_ids,child_ids)
      select id,label,slug,description,uri,aliases,parent_ids,child_ids from oracle_tags_stage
      on conflict (id) do update set
        label=excluded.label, slug=excluded.slug, description=excluded.description,
        uri=excluded.uri, aliases=excluded.aliases, parent_ids=excluded.parent_ids,
        child_ids=excluded.child_ids, updated_at=now()
      where (oracle_tags.label,oracle_tags.slug,oracle_tags.description,
             oracle_tags.uri,oracle_tags.aliases,oracle_tags.parent_ids,oracle_tags.child_ids)
        is distinct from
            (excluded.label,excluded.slug,excluded.description,
             excluded.uri,excluded.aliases,excluded.parent_ids,excluded.child_ids)`);
    const linksWritten = await db.unsafe(`
      insert into public.oracle_tag_cards (tag_id,oracle_id,weight)
      select tag_id,oracle_id,weight from oracle_tag_cards_stage
      on conflict (tag_id,oracle_id) do update set weight=excluded.weight
      where oracle_tag_cards.weight is distinct from excluded.weight`);
    await db.unsafe(`
      delete from public.oracle_tag_cards c
      where not exists (select 1 from oracle_tag_cards_stage s
                        where s.tag_id=c.tag_id and s.oracle_id=c.oracle_id)`);
    await db.unsafe("commit");
    return { received: seen.size, linked, written: metadata.count + linksWritten.count };
  } catch (error) {
    await db.unsafe("rollback").catch(() => {});
    throw error;
  } finally {
    await db.unsafe("drop table if exists oracle_tag_cards_stage").catch(() => {});
    await db.unsafe("drop table if exists oracle_tags_stage").catch(() => {});
  }
}

async function stageRulings(db: ReservedSql, entry: ScryfallBulkEntry, contact: string) {
  const lines: string[] = [];
  const seen = new Set<string>();
  await streamFeed(entry, contact, (value) => {
    const ruling = toOracleRuling(value);
    if (seen.has(ruling.content_hash)) return;
    seen.add(ruling.content_hash);
    lines.push(copyLine([
      ruling.content_hash, ruling.oracle_id, ruling.source,
      ruling.published_at, ruling.comment,
    ]));
  });
  const [{ stored }] = await db<{ stored: number }[]>`
    select count(*)::int as stored from public.oracle_rulings`;
  checkAuxiliaryFeedSize("rulings", lines.length, stored, MIN_RULINGS);

  await db.unsafe("create temp table oracle_rulings_stage (like public.oracle_rulings)");
  await copyRows(db, "oracle_rulings_stage", "content_hash,oracle_id,source,published_at,comment", lines);
  await db.unsafe("analyze oracle_rulings_stage");
  lines.length = 0;
  await db.unsafe("begin");
  try {
    const written = await db.unsafe(`
      insert into public.oracle_rulings (content_hash,oracle_id,source,published_at,comment)
      select content_hash,oracle_id,source,published_at,comment from oracle_rulings_stage
      on conflict (content_hash) do nothing`);
    await db.unsafe(`
      delete from public.oracle_rulings r
      where not exists (select 1 from oracle_rulings_stage s
                        where s.content_hash=r.content_hash)`);
    await db.unsafe("commit");
    return { received: seen.size, linked: 0, written: written.count };
  } catch (error) {
    await db.unsafe("rollback").catch(() => {});
    throw error;
  } finally {
    await db.unsafe("drop table if exists oracle_rulings_stage").catch(() => {});
  }
}

let active: { db: ReservedSql; id: number; feed: Feed } | null = null;
async function markFailed(error: unknown) {
  const run = active;
  if (!run) return;
  active = null;
  await run.db`
    update public.scryfall_sync_runs
       set status='failed', error_message=${describe(error).slice(0, 2000)}, finished_at=now()
     where id=${run.id}`.catch((writeError: unknown) => {
    console.error(`[auxiliary-sync] could not record ${run.feed} failure: ${describe(writeError)}`);
  });
}

async function loadOne(db: ReservedSql, feed: Feed, entry: ScryfallBulkEntry, force: boolean, contact: string) {
  const [last] = await db<{ bulk_updated_at: Date | null }[]>`
    select bulk_updated_at from public.scryfall_sync_runs
    where bulk_type=${feed} and status='succeeded'
    order by started_at desc limit 1`;
  const [{ stored }] = feed === "oracle_tags"
    ? await db<{ stored: number }[]>`select count(*)::int as stored from public.oracle_tag_cards`
    : await db<{ stored: number }[]>`select count(*)::int as stored from public.oracle_rulings`;
  const minimum = feed === "oracle_tags" ? MIN_TAGGINGS : MIN_RULINGS;
  const current = last?.bulk_updated_at != null &&
    new Date(last.bulk_updated_at).getTime() === new Date(entry.updated_at).getTime();
  if (current && stored >= minimum && !force) {
    await db`
      insert into public.scryfall_sync_runs (bulk_type,bulk_updated_at,status,finished_at)
      values (${feed},${entry.updated_at}::timestamptz,'skipped',now())`;
    log(`${feed}: export unchanged; skipped`);
    return;
  }

  const [run] = await db<{ id: number }[]>`
    insert into public.scryfall_sync_runs (bulk_type,bulk_updated_at,status)
    values (${feed},${entry.updated_at}::timestamptz,'running') returning id`;
  active = { db, id: Number(run.id), feed };
  try {
    log(`${feed}: downloading ${entry.jsonl_download_uri}`);
    const result = feed === "oracle_tags"
      ? await stageTags(db, entry, contact)
      : await stageRulings(db, entry, contact);
    await db`
      update public.scryfall_sync_runs
         set status='succeeded',cards_upserted=${result.written},finished_at=now()
       where id=${run.id}`;
    active = null;
    log(
      `${feed}: ${result.received.toLocaleString()} records` +
      (result.linked ? `, ${result.linked.toLocaleString()} card links` : "") +
      `, ${result.written.toLocaleString()} changed rows`,
    );
  } catch (error) {
    await markFailed(error);
    throw error;
  }
}

async function main() {
  const url = process.env.SCRYFALL_SYNC_DATABASE_URL;
  if (!url) throw new Error("SCRYFALL_SYNC_DATABASE_URL is required for the direct catalog loader");
  const force = process.argv.includes("--force");
  const contact = process.env.SCRYFALL_CONTACT || "project-upkeep (https://github.com/atalpak/ProjectUpkeep)";
  const response = await fetch(SCRYFALL_BULK_INDEX_URL, { headers: scryfallHeaders(contact) });
  if (!response.ok) throw new Error(`Bulk-data index returned ${response.status}`);
  const index = (await response.json()) as { data?: ScryfallBulkEntry[] };
  const sql = postgres(connectionOptions(url, process.env.SCRYFALL_SYNC_DATABASE_CA || undefined));
  try {
    const db = await sql.reserve();
    await db.unsafe(`set statement_timeout = '${LOADER_STATEMENT_TIMEOUT}'`);
    await db.unsafe(`set lock_timeout = '${LOADER_LOCK_TIMEOUT}'`);
    const failures: string[] = [];
    for (const feed of ["oracle_tags", "rulings"] as const) {
      const entry = index.data?.find((item) => item.type === feed);
      if (!entry) {
        failures.push(`${feed}: missing from bulk-data index`);
        continue;
      }
      try {
        await loadOne(db, feed, entry, force, contact);
      } catch (error) {
        failures.push(`${feed}: ${describe(error)}`);
      }
    }
    if (failures.length) throw new Error(failures.join("; "));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void markFailed(new Error(`Loader interrupted by ${signal}`)).finally(() => process.exit(1));
  });
}
main().catch((error) => {
  console.error(`[auxiliary-sync] FAILED: ${describe(error)}`);
  process.exitCode = 1;
});
