/**
 * The mechanical backstop for "playing never writes the collection".
 *
 * ESLint fences the play UI and the pure core (eslint.config.mjs), but the
 * server actions in `src/app/(app)/decks/[id]/play/actions.ts` are the one
 * place that legitimately talks to the database, and a lint rule cannot say
 * "this file may name these three tables and no others". So this test reads
 * the file's source and enforces it directly:
 *
 *   - every `.from("x")` names playtest_sessions, playtest_shares or
 *     locations, and `locations` is only ever selected from (the deck-owner
 *     check), never written;
 *   - the table name is a string literal, so the check cannot be dodged by
 *     passing a variable;
 *   - no `.rpc(` at all (a stored function could write anything), no storage
 *     or edge-function calls, and no service-role wording.
 *
 * The scanner is a plain function with its own fixture tests, including the
 * cases it must REJECT, so a future edit that quietly weakens the regexes
 * shows up as a failing test rather than a green run over a leaky file.
 *
 * Run with: npx tsx --test scripts/playtest-boundary.test.ts
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ALLOWED_TABLES = new Set(["playtest_sessions", "playtest_shares", "locations"]);
const READ_ONLY_TABLES = new Set(["locations"]);
const WRITE_VERB = /\.\s*(insert|update|upsert|delete)\s*\(/;

/** Returns a list of human-readable violations; empty means clean. */
export function scanActionsSource(source: string): string[] {
  const problems: string[] = [];
  // Strip comments so a sentence like "never .rpc(...)" in prose cannot trip
  // (or hide) a finding.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const fromCall = /\.from\s*\(\s*([^)]*?)\s*\)/g;
  for (const match of code.matchAll(fromCall)) {
    const arg = match[1];
    const literal = /^(["'`])([a-z_]+)\1$/.exec(arg);
    if (!literal) {
      problems.push(`.from(${arg}) is not a plain string literal`);
      continue;
    }
    const table = literal[2];
    if (!ALLOWED_TABLES.has(table)) {
      problems.push(`.from("${table}") names a table outside the playtest tables`);
      continue;
    }
    if (READ_ONLY_TABLES.has(table)) {
      // Look at the rest of this statement only.
      const rest = code.slice((match.index ?? 0) + match[0].length);
      const statement = rest.slice(0, rest.search(/;/) === -1 ? rest.length : rest.search(/;/));
      if (WRITE_VERB.test(statement)) problems.push(`.from("${table}") is written to; it is read-only here`);
    }
  }

  if (/\.\s*rpc\s*\(/.test(code)) problems.push(".rpc( is not allowed in the play actions");
  if (/\.\s*storage\b/.test(code)) problems.push("storage access is not allowed in the play actions");
  if (/\.\s*functions\s*\.\s*invoke/.test(code)) problems.push("edge-function calls are not allowed in the play actions");
  if (/service[_-]?role/i.test(code)) problems.push("service-role wording found (hard constraint 4)");
  return problems;
}

const CLEAN = `
  const a = await supabase.from("playtest_sessions").insert({ title });
  const b = await supabase.from('playtest_shares').update({ title }).eq("id", id);
  const c = await supabase.from("locations").select("id, user_id").eq("id", deckId).maybeSingle();
`;

test("the scanner accepts an actions file that only touches the playtest tables and reads locations", () => {
  assert.deepEqual(scanActionsSource(CLEAN), []);
});

test("the scanner rejects a table outside the allow-list", () => {
  for (const table of ["card_instances", "deck_cards", "ownership_history", "profiles"]) {
    const problems = scanActionsSource(`await supabase.from("${table}").select("*");`);
    assert.equal(problems.length, 1, table);
  }
});

test("the scanner rejects writing to locations (it is only ever read, to check deck ownership)", () => {
  for (const verb of ["insert", "update", "upsert", "delete"]) {
    const problems = scanActionsSource(`await supabase.from("locations").${verb}({ a: 1 }).eq("id", x);`);
    assert.equal(problems.length, 1, verb);
  }
});

test("the scanner rejects a non-literal table name", () => {
  assert.equal(scanActionsSource("await supabase.from(table).select();").length, 1);
  assert.equal(scanActionsSource("await supabase.from(`card_${x}`).select();").length, 1);
});

test("the scanner rejects rpc, storage, edge functions and service-role wording", () => {
  assert.equal(scanActionsSource('await supabase.rpc("accept_trade", {});').length, 1);
  assert.equal(scanActionsSource('await supabase.storage.from("b");').length >= 1, true);
  assert.equal(scanActionsSource('await supabase.functions.invoke("f");').length, 1);
  assert.equal(scanActionsSource("const key = SUPABASE_SERVICE_ROLE_KEY;").length, 1);
});

test("prose in comments neither trips nor hides a finding", () => {
  assert.deepEqual(scanActionsSource('// never .rpc("x") here\n/* .from("card_instances") */\nconst a = 1;'), []);
  assert.equal(scanActionsSource('// fine\nawait supabase.from("deck_cards").select();').length, 1);
});

/** Any write verb at all: for the read-only loaders in sessions.ts. */
export function writeVerbs(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/\.\s*(insert|update|upsert|delete)\s*\(/g)].map((m) => m[1]);
}

/** "use server" files may export only async functions. */
export function nonActionExports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/^export\s+(?!async function\b|type\b|interface\b)(.+)$/gm)].map((m) => m[0].slice(0, 60));
}

const PLAY = join(process.cwd(), "src", "app", "(app)", "decks", "[id]", "play");

test("the REAL actions.ts touches only the playtest tables (locations read-only) and never calls rpc", () => {
  const source = readFileSync(join(PLAY, "actions.ts"), "utf8");
  assert.deepEqual(scanActionsSource(source), []);
  // Sanity that the scan is looking at the file we mean and can see its tables.
  const tables = [...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.ok(tables.includes("playtest_sessions") && tables.includes("playtest_shares") && tables.includes("locations"), tables.join(","));
  assert.deepEqual([...new Set(tables)].sort(), ["locations", "playtest_sessions", "playtest_shares"]);
});

test("actions.ts is a 'use server' file that exports nothing but async functions", () => {
  const source = readFileSync(join(PLAY, "actions.ts"), "utf8");
  assert.match(source, /^"use server";/m);
  assert.deepEqual(nonActionExports(source), []);
  const exported = [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["createShare", "deleteSession", "deleteShare", "duplicateSession", "overwriteSession", "refreshShare", "renameSession", "saveSession"]);
});

test("every action re-checks the deck against the caller and takes the owner from auth, not from an argument", () => {
  const source = readFileSync(join(PLAY, "actions.ts"), "utf8");
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /\.eq\("user_id", data\.user\.id\)/, "the deck check filters on user_id (constraint 3)");
  assert.match(source, /\.eq\("type", "deck"\)/);
  for (const name of ["saveSession", "overwriteSession", "renameSession", "duplicateSession", "deleteSession", "createShare", "refreshShare", "deleteShare"]) {
    const body = source.slice(source.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 400), /authorize\(deckId\)/, `${name} must authorize first`);
  }
  assert.ok(!/owner_user_id:\s*input/.test(source), "an owner id is never read from an argument");
});

test("sessions.ts (the page's loaders) is strictly read-only and filters on owner and deck", () => {
  const source = readFileSync(join(PLAY, "sessions.ts"), "utf8");
  assert.deepEqual(writeVerbs(source), []);
  assert.deepEqual(scanActionsSource(source), []);
  assert.ok((source.match(/\.eq\("owner_user_id", userId\)/g) ?? []).length >= 3, "every loader scopes to the owner");
  assert.ok((source.match(/\.eq\("deck_id", deckId\)/g) ?? []).length >= 3, "and to the deck");
});

test("the write-verb and export scanners can fail", () => {
  assert.deepEqual(writeVerbs('await s.from("playtest_sessions").delete().eq("id", 1);'), ["delete"]);
  assert.deepEqual(writeVerbs("// .update( in a comment\nconst a = 1;"), []);
  assert.equal(nonActionExports('"use server";\nexport const LIMIT = 5;\nexport async function a() {}').length, 1);
  assert.equal(nonActionExports('export type T = string;\nexport async function a() {}').length, 0);
});

test("the play UI and route never import the collection writers (a second look, beside the lint fence)", () => {
  const roots = [join(process.cwd(), "src", "components", "playtester"), PLAY];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith("page.tsx")) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)) {
          if (/^@\/lib\/(collection|import)\//.test(m[1]) || /^@\/components\/decks\//.test(m[1])) offenders.push(`${full}: ${m[1]}`);
        }
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  assert.deepEqual(offenders, []);
});
