/**
 * The catalog export's paging loop.
 *
 * What matters: every row comes out exactly once and in key order, each
 * request asks for the rows *after* the last one seen (never an offset), a
 * timed-out page is retried but any other failure is not, and a cursor that
 * fails to advance cannot loop forever.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectAllRows, isStatementTimeout, type CardRow } from "./export-catalog-paging";

const ids = (n: number): CardRow[] =>
  Array.from({ length: n }, (_, i) => ({ scryfall_id: String(i).padStart(6, "0"), name: `c${i}` }));

/** A fake table: honours `after` and the page size the way the query does. */
function table(all: CardRow[], pageSize: number, calls: (string | null)[] = []) {
  return async (after: string | null) => {
    calls.push(after);
    // A loop that never advances would otherwise pile up rows until the whole
    // file dies; fail the one test instead.
    if (calls.length > 50) throw new Error("runaway: cursor never advanced");
    return all.filter((r) => after === null || r.scryfall_id > after).slice(0, pageSize);
  };
}

const noWait = { sleep: async () => {} };
const timeout = () => Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });

test("collects every row once, in order, across pages", { timeout: 2000 }, async () => {
  const all = ids(2500);
  const rows = await collectAllRows(table(all, 1000), { pageSize: 1000 });
  assert.deepEqual(rows, all);
});

test("an exact multiple of the page size ends on the empty page", { timeout: 2000 }, async () => {
  const calls: (string | null)[] = [];
  const rows = await collectAllRows(table(ids(2000), 1000, calls), { pageSize: 1000 });
  assert.equal(rows.length, 2000);
  assert.equal(calls.length, 3);
});

test("each request keys on the last id seen, not an offset", { timeout: 2000 }, async () => {
  const calls: (string | null)[] = [];
  await collectAllRows(table(ids(2500), 1000, calls), { pageSize: 1000 });
  assert.deepEqual(calls, [null, "000999", "001999"]);
});

test("empty table yields no rows", async () => {
  assert.deepEqual(await collectAllRows(table([], 1000), { pageSize: 1000 }), []);
});

test("limit stops early and truncates", { timeout: 2000 }, async () => {
  const rows = await collectAllRows(table(ids(5000), 1000), { pageSize: 1000, limit: 1500 });
  assert.equal(rows.length, 1500);
});

test("a timed-out page is retried with backoff and the export completes", async () => {
  const all = ids(1500);
  const inner = table(all, 1000);
  let failures = 2;
  const waits: number[] = [];
  const rows = await collectAllRows(
    async (after) => {
      if (after !== null && failures-- > 0) throw timeout();
      return inner(after);
    },
    { pageSize: 1000, backoffMs: [10, 20, 40], sleep: async (ms) => void waits.push(ms) },
  );
  assert.deepEqual(rows, all);
  assert.deepEqual(waits, [10, 20]);
});

test("gives up after the last backoff and rethrows the timeout", async () => {
  await assert.rejects(
    collectAllRows(async () => { throw timeout(); }, { pageSize: 1000, backoffMs: [1, 1], ...noWait }),
    /statement timeout/,
  );
});

test("a non-timeout error is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    collectAllRows(async () => { calls++; throw new Error("permission denied for table cards"); }, {
      pageSize: 1000,
      ...noWait,
    }),
    /permission denied/,
  );
  assert.equal(calls, 1);
});

test("a correct loop over 3 pages takes 4 calls, keyed on each page's last id", { timeout: 2000 }, async () => {
  const cursors: (string | null)[] = [];
  const inner = table(ids(2500), 1000);
  const rows = await collectAllRows(
    async (after) => {
      cursors.push(after);
      // Distinct error so a runaway loop fails loudly rather than hanging.
      if (cursors.length > 5) throw new Error("runaway: cursor never advanced");
      return inner(after);
    },
    { pageSize: 1000, ...noWait },
  );
  assert.equal(rows.length, 2500);
  assert.deepEqual(cursors, [null, "000999", "001999"]);
});

test("a cursor that does not advance fails instead of looping", { timeout: 2000 }, async () => {
  let calls = 0;
  const stuck = async () => {
    if (++calls > 5) throw new Error("runaway: guard never fired");
    return ids(1000); // same full page every time
  };
  await assert.rejects(collectAllRows(stuck, { pageSize: 1000, ...noWait }), /did not advance/);
});

test("isStatementTimeout recognises the code and the message, nothing else", () => {
  assert.equal(isStatementTimeout({ code: "57014" }), true);
  assert.equal(isStatementTimeout(new Error("canceling statement due to statement timeout")), true);
  assert.equal(isStatementTimeout(new Error("fetch failed")), false);
  assert.equal(isStatementTimeout(null), false);
});
