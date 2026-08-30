/**
 * Tests for the bulk-export streaming reader.
 *
 * These serve a synthetic bulk file over a real local HTTP server and read it
 * with a real fetch(), so the fetch -> web stream -> Node stream -> stream-json
 * wiring is exercised end to end. That plumbing is the part that fails
 * silently; the mapping it feeds is covered in sync-scryfall.test.ts.
 *
 * Run with: npx tsx --test scripts/scryfall-stream.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { once } from "node:events";

import { streamCardRows } from "../src/lib/scryfall-stream";
import type { CardRow } from "../src/lib/scryfall";

const SYNCED_AT = "2026-01-01T00:00:00.000Z";

function fakeCard(i: number) {
  return {
    id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
    oracle_id: "ffffffff-0000-0000-0000-000000000001",
    name: `Test Card ${i}`,
    set: "tst",
    set_name: "Test Set",
    collector_number: String(i),
    rarity: "common",
    type_line: "Instant",
    released_at: "2020-01-01",
    lang: "en",
    finishes: ["nonfoil"],
    image_uris: { small: `https://img/${i}/s`, normal: `https://img/${i}/n` },
  };
}

/** Serves `body` once, then shuts down. Returns the URL. */
async function serveOnce(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    // Write in small chunks so the consumer really has to reassemble a stream
    // rather than getting one convenient buffer.
    for (let i = 0; i < body.length; i += 1024) res.write(body.slice(i, i + 1024));
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/bulk.json`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

test("streams a large array over HTTP in batches, preserving every record", async () => {
  const total = 2500;
  const body = JSON.stringify(Array.from({ length: total }, (_, i) => fakeCard(i)));
  const { url, close } = await serveOnce(body);

  try {
    const batches: CardRow[][] = [];
    const result = await streamCardRows((await fetch(url)).body!, {
      batchSize: 500,
      syncedAt: SYNCED_AT,
      onBatch: async (rows) => {
        batches.push(rows);
      },
    });

    assert.equal(result.processed, total);
    assert.equal(result.skipped, 0);
    assert.equal(result.stoppedEarly, false);

    assert.equal(batches.length, 5, "2500 rows at batchSize 500 should be 5 batches");
    assert.ok(
      batches.every((b) => b.length === 500),
      "every batch should be full",
    );

    const ids = new Set(batches.flat().map((r) => r.scryfall_id));
    assert.equal(ids.size, total, "no rows dropped or duplicated");
    assert.equal(batches[0][0].name, "Test Card 0", "order preserved");
  } finally {
    await close();
  }
});

test("emits a final partial batch", async () => {
  const body = JSON.stringify(Array.from({ length: 7 }, (_, i) => fakeCard(i)));
  const { url, close } = await serveOnce(body);
  try {
    const sizes: number[] = [];
    const result = await streamCardRows((await fetch(url)).body!, {
      batchSize: 3,
      syncedAt: SYNCED_AT,
      onBatch: async (rows) => {
        sizes.push(rows.length);
      },
    });
    assert.deepEqual(sizes, [3, 3, 1]);
    assert.equal(result.processed, 7);
  } finally {
    await close();
  }
});

test("counts unusable records instead of writing half-rows", async () => {
  const body = JSON.stringify([
    fakeCard(1),
    { id: "", name: "No id", set: "tst", collector_number: "2" },
    { ...fakeCard(3), set: "" },
    fakeCard(4),
  ]);
  const { url, close } = await serveOnce(body);
  try {
    const rows: CardRow[] = [];
    const result = await streamCardRows((await fetch(url)).body!, {
      batchSize: 10,
      syncedAt: SYNCED_AT,
      onBatch: async (b) => {
        rows.push(...b);
      },
    });
    assert.equal(result.processed, 2);
    assert.equal(result.skipped, 2);
    assert.equal(rows.length, 2);
  } finally {
    await close();
  }
});

test("--limit stops early without erroring on the unread remainder", async () => {
  const body = JSON.stringify(Array.from({ length: 5000 }, (_, i) => fakeCard(i)));
  const { url, close } = await serveOnce(body);
  try {
    const result = await streamCardRows((await fetch(url)).body!, {
      batchSize: 100,
      syncedAt: SYNCED_AT,
      limit: 300,
      onBatch: async () => {},
    });
    assert.equal(result.stoppedEarly, true);
    assert.equal(result.processed, 300);
  } finally {
    await close();
  }
});

test("applies backpressure: a slow sink does not race ahead", async () => {
  const body = JSON.stringify(Array.from({ length: 1000 }, (_, i) => fakeCard(i)));
  const { url, close } = await serveOnce(body);
  try {
    let inFlight = 0;
    let maxConcurrent = 0;
    await streamCardRows((await fetch(url)).body!, {
      batchSize: 100,
      syncedAt: SYNCED_AT,
      onBatch: async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
    });
    assert.equal(maxConcurrent, 1, "batches must be awaited one at a time");
  } finally {
    await close();
  }
});

test("a failing sink aborts the run rather than silently continuing", async () => {
  const body = JSON.stringify(Array.from({ length: 1000 }, (_, i) => fakeCard(i)));
  const { url, close } = await serveOnce(body);
  try {
    let calls = 0;
    await assert.rejects(
      streamCardRows((await fetch(url)).body!, {
        batchSize: 100,
        syncedAt: SYNCED_AT,
        onBatch: async () => {
          calls += 1;
          if (calls === 2) throw new Error("upsert exploded");
        },
      }),
      /upsert exploded/,
    );
    assert.equal(calls, 2, "should stop at the failing batch, not keep going");
  } finally {
    await close();
  }
});

test("accepts a plain Node stream as well as a web stream", async () => {
  const body = JSON.stringify([fakeCard(1), fakeCard(2)]);
  const rows: CardRow[] = [];
  const result = await streamCardRows(Readable.from([body]), {
    batchSize: 10,
    syncedAt: SYNCED_AT,
    onBatch: async (b) => {
      rows.push(...b);
    },
  });
  assert.equal(result.processed, 2);
  assert.equal(rows[0].last_synced_at, SYNCED_AT);
});
