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
import { readFileSync } from "node:fs";
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
