/**
 * The bulk sync's write path.
 *
 * The behaviour that matters: a statement timeout must not lose the run, and
 * the smaller chunk size it forces must stick rather than being rediscovered
 * on every batch for the rest of a 118,000-row job.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createChunkedWriter,
  isStatementTimeout,
  type WriteResult,
} from "../src/lib/scryfall-upsert";
import type { CardRow } from "../src/lib/scryfall";

/** Rows only ever get counted and sliced here, so an id is enough. */
const rows = (n: number): CardRow[] =>
  Array.from({ length: n }, (_, i) => ({ scryfall_id: `card-${i}` }) as unknown as CardRow);

const ok: WriteResult = { error: null };
const timeout: WriteResult = {
  error: { code: "57014", message: "canceling statement due to statement timeout" },
};

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Recognising the error
// ---------------------------------------------------------------------------

test("a statement timeout is recognised by code or by message", () => {
  assert.equal(isStatementTimeout({ code: "57014", message: "whatever" }), true);
  assert.equal(
    isStatementTimeout({ message: "canceling statement due to statement timeout" }),
    true,
    "PostgREST does not always pass the code through",
  );
  assert.equal(isStatementTimeout({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isStatementTimeout(null), false);
});

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

test("a clean run writes one statement per chunk and shrinks nothing", async () => {
  const sizes: number[] = [];
  const writer = createChunkedWriter({
    startSize: 500,
    sleep: noSleep,
    write: async (batch) => {
      sizes.push(batch.length);
      return ok;
    },
  });

  await writer.write(rows(1200));

  assert.deepEqual(sizes, [500, 500, 200]);
  assert.equal(writer.chunkSize(), 500);
  assert.equal(writer.splits(), 0);
});

test("a timeout splits the chunk and both halves are written", async () => {
  const sizes: number[] = [];
  let failuresLeft = 1;
  const writer = createChunkedWriter({
    startSize: 500,
    sleep: noSleep,
    write: async (batch) => {
      sizes.push(batch.length);
      if (batch.length === 500 && failuresLeft > 0) {
        failuresLeft -= 1;
        return timeout;
      }
      return ok;
    },
  });

  await writer.write(rows(500));

  assert.deepEqual(sizes, [500, 250, 250], "the failed 500 is retried as two 250s");
  assert.equal(writer.splits(), 1);
});

test("the smaller size sticks for the rest of the run", async () => {
  const sizes: number[] = [];
  const writer = createChunkedWriter({
    startSize: 500,
    sleep: noSleep,
    write: async (batch) => {
      sizes.push(batch.length);
      return batch.length > 250 ? timeout : ok;
    },
  });

  await writer.write(rows(1500));

  assert.equal(writer.chunkSize(), 250);
  // 500 fails once, splits into two 250s; every chunk after that is asked for
  // at 250 and goes straight through — the timeout is not rediscovered.
  assert.deepEqual(sizes, [500, 250, 250, 250, 250, 250, 250]);
  assert.equal(writer.splits(), 1, "one split, not one per remaining batch");
});

test("it keeps halving when a database is really struggling", async () => {
  const writer = createChunkedWriter({
    startSize: 400,
    sleep: noSleep,
    write: async (batch) => (batch.length > 50 ? timeout : ok),
  });

  await writer.write(rows(400));

  assert.equal(writer.chunkSize(), 50);
  assert.ok(writer.splits() >= 3);
});

test("a timeout at the floor fails the run rather than halving forever", async () => {
  const writer = createChunkedWriter({
    startSize: 50,
    minSize: 50,
    sleep: noSleep,
    write: async () => timeout,
  });

  await assert.rejects(
    () => writer.write(rows(50)),
    /timed out at the smallest chunk size/,
    "a database that cannot write 50 rows needs a person, not another halving",
  );
});

// ---------------------------------------------------------------------------
// Errors that are not timeouts
// ---------------------------------------------------------------------------

test("a transient error is retried at the same size", async () => {
  const sizes: number[] = [];
  let failuresLeft = 2;
  const writer = createChunkedWriter({
    startSize: 500,
    sleep: noSleep,
    write: async (batch) => {
      sizes.push(batch.length);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { error: { message: "fetch failed" } };
      }
      return ok;
    },
  });

  await writer.write(rows(500));

  assert.deepEqual(sizes, [500, 500, 500], "retried whole, not split");
  assert.equal(writer.chunkSize(), 500, "a dropped connection says nothing about size");
  assert.equal(writer.retries(), 2);
});

test("a real error fails the run after its retries", async () => {
  const writer = createChunkedWriter({
    startSize: 100,
    maxRetries: 2,
    sleep: noSleep,
    write: async () => ({ error: { code: "23502", message: "null value in column" } }),
  });

  await assert.rejects(() => writer.write(rows(100)), /failed after 2 retries/);
});

test("an error that turns into a timeout on retry still splits", async () => {
  const sizes: number[] = [];
  let first = true;
  const writer = createChunkedWriter({
    startSize: 200,
    sleep: noSleep,
    write: async (batch) => {
      sizes.push(batch.length);
      if (first) {
        first = false;
        return { error: { message: "fetch failed" } };
      }
      return batch.length > 100 ? timeout : ok;
    },
  });

  await writer.write(rows(200));

  assert.deepEqual(sizes, [200, 200, 100, 100]);
  assert.equal(writer.splits(), 1);
});

test("writing nothing does nothing", async () => {
  let calls = 0;
  const writer = createChunkedWriter({
    startSize: 500,
    sleep: noSleep,
    write: async () => {
      calls += 1;
      return ok;
    },
  });

  await writer.write([]);
  assert.equal(calls, 0);
});
