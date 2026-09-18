/**
 * The sync's retry policy.
 *
 * What matters: a dropped connection gets another go, a struggling database
 * does not, and the retries can never outrun the workflow's timeout.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";

import { streamCardRows } from "../src/lib/scryfall-stream";

import { isTransientNetworkError, withRetry } from "./sync-retry";

/** undici's real shape: TypeError("terminated") with the socket error as cause. */
function undiciDrop(): Error {
  const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  return new TypeError("terminated", { cause });
}

const dbTimeout = () =>
  new Error(
    "Upsert of 25 cards timed out at the smallest chunk size (25). " +
      "The database is not keeping up: canceling statement due to statement timeout",
  );

/** A clock the test advances by hand, and a sleep that advances it. */
function fakeTime() {
  let t = 0;
  const waits: number[] = [];
  return {
    waits,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

test("the 2026-09-18 undici drop is a network error", () => {
  assert.equal(isTransientNetworkError(undiciDrop()), true);
});

test("recognises network errors by code alone, or by message alone", () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET"]) {
    assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { code })), true, code);
  }
  assert.equal(isTransientNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isTransientNetworkError(new TypeError("terminated")), true);
});

test("a database timeout is not retried", () => {
  assert.equal(isTransientNetworkError(dbTimeout()), false);
  assert.equal(
    isTransientNetworkError(Object.assign(new Error("boom"), { code: "57014" })),
    false,
  );
});

test("an upsert failure is database-side even if it says 'fetch failed'", () => {
  assert.equal(
    isTransientNetworkError(
      new Error("Upsert of 500 cards failed after 3 retries: TypeError: fetch failed"),
    ),
    false,
  );
});

test("a 57014 error is not retried even with a network-coded cause", () => {
  const error = Object.assign(new Error("boom"), {
    code: "57014",
    cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
  });
  assert.equal(isTransientNetworkError(error), false);
});

test("a database error wrapped as the cause of 'terminated' is not retried", () => {
  assert.equal(isTransientNetworkError(new TypeError("terminated", { cause: dbTimeout() })), false);
  assert.equal(
    isTransientNetworkError(
      new TypeError("terminated", {
        cause: new Error("Upsert of 500 cards failed after 3 retries: fetch failed"),
      }),
    ),
    false,
  );
});

test("a truncated gzip (Z_BUF_ERROR) is retryable", () => {
  const error = Object.assign(new Error("unexpected end of file"), { code: "Z_BUF_ERROR" });
  assert.equal(isTransientNetworkError(error), true);
});

test("a source error through pipeline(source, gunzip) reaches streamCardRows exactly once", async () => {
  // The composition sync-scryfall.ts uses. With .pipe() this was an unhandled
  // 'error' event on the source; now it must be an ordinary rejection.
  const failure = undiciDrop();
  const source = new Readable({ read() {} });
  const gunzip = createGunzip();
  let callbackCalls = 0;
  pipeline(source, gunzip, () => {
    callbackCalls += 1;
  });
  setImmediate(() => source.destroy(failure));

  let rejections = 0;
  await streamCardRows(gunzip, {
    batchSize: 10,
    syncedAt: "2026-01-01T00:00:00Z",
    onBatch: async () => {},
  }).catch((error) => {
    rejections += 1;
    assert.equal(error, failure);
  });
  assert.equal(rejections, 1);
  assert.equal(callbackCalls, 1);
});

test("validation, HTTP and unknown errors are not retried", () => {
  assert.equal(isTransientNetworkError(new Error("Bulk download returned 404 Not Found")), false);
  assert.equal(isTransientNetworkError(new Error("batchSize must be a positive integer")), false);
  assert.equal(isTransientNetworkError("terminated"), false);
  assert.equal(isTransientNetworkError(null), false);
});

test("a cyclic cause chain does not hang the classifier", () => {
  const a = new Error("a") as Error & { cause?: unknown };
  a.cause = a;
  assert.equal(isTransientNetworkError(a), false);
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

test("succeeds first time with no waiting", async () => {
  const time = fakeTime();
  const result = await withRetry(async () => "ok", { sleep: time.sleep, now: time.now });
  assert.equal(result, "ok");
  assert.deepEqual(time.waits, []);
});

test("retries a network error, waiting 15s then 45s, and returns the eventual result", async () => {
  const time = fakeTime();
  const seen: number[] = [];
  const result = await withRetry(
    async (attempt) => {
      seen.push(attempt);
      if (attempt < 3) throw undiciDrop();
      return "done";
    },
    { sleep: time.sleep, now: time.now },
  );
  assert.equal(result, "done");
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(time.waits, [15_000, 45_000]);
});

test("gives up after three attempts with the last error", async () => {
  const time = fakeTime();
  let calls = 0;
  const errors = [undiciDrop(), undiciDrop(), undiciDrop()];
  await assert.rejects(
    withRetry(
      async () => {
        throw errors[calls++];
      },
      { sleep: time.sleep, now: time.now },
    ),
    (error) => error === errors[2],
  );
  assert.equal(calls, 3);
  assert.deepEqual(time.waits, [15_000, 45_000]);
});

test("does not retry a database error", async () => {
  const time = fakeTime();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw dbTimeout();
      },
      { sleep: time.sleep, now: time.now },
    ),
    /statement timeout/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(time.waits, []);
});

test("a network error followed by a database error stops at the database error", async () => {
  const time = fakeTime();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async (attempt) => {
        calls += 1;
        throw attempt === 1 ? undiciDrop() : dbTimeout();
      },
      { sleep: time.sleep, now: time.now },
    ),
    /statement timeout/,
  );
  assert.equal(calls, 2);
});

test("each attempt is told its number so it can start from a clean slate", async () => {
  const time = fakeTime();
  let counter = 0;
  const finals: number[] = [];
  await withRetry(
    async (attempt) => {
      counter = 0; // what the sync does at the top of a pass
      counter += 100;
      if (attempt === 1) throw undiciDrop();
      finals.push(counter);
    },
    { sleep: time.sleep, now: time.now },
  );
  assert.deepEqual(finals, [100]);
});

test("will not start a retry that cannot fit in the time budget", async () => {
  const time = fakeTime();
  let calls = 0;
  const gaveUp: string[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        time.advance(20 * 60_000); // a long pass that then drops
        throw undiciDrop();
      },
      {
        budgetMs: 30 * 60_000,
        sleep: time.sleep,
        now: time.now,
        onGiveUp: ({ reason }) => gaveUp.push(reason),
      },
    ),
    /terminated/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(time.waits, []);
  assert.match(gaveUp[0], /time/);
});

test("reports each retry to the caller", async () => {
  const time = fakeTime();
  const notes: Array<[number, number, number]> = [];
  await withRetry(
    async (attempt) => {
      if (attempt < 3) throw undiciDrop();
    },
    {
      sleep: time.sleep,
      now: time.now,
      onRetry: ({ attempt, nextAttempt, waitMs }) => notes.push([attempt, nextAttempt, waitMs]),
    },
  );
  assert.deepEqual(notes, [
    [1, 2, 15_000],
    [2, 3, 45_000],
  ]);
});
