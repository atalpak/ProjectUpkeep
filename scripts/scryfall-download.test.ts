/**
 * The download-to-disk step of the Scryfall sync.
 *
 * What matters: the temp file never outlives its attempt, a short download is
 * refused before any row is upserted, and a failed download is retried as a
 * network error with a clean file each time. Fake sources only, no network.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  incompleteDownloadError,
  parseContentLength,
  withDownloadedFile,
  type DownloadSource,
} from "../src/lib/scryfall-download";

import { isTransientNetworkError, withRetry } from "./sync-retry";

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "download-test-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const leftovers = () => readdir(root);

function bytesSource(data: Buffer, expectedBytes: number | null = data.length): DownloadSource {
  return { body: Readable.from([data]), expectedBytes };
}

/** Delivers `first`, then fails the way undici does when the socket drops. */
function droppingSource(first: Buffer): DownloadSource {
  const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  async function* chunks() {
    yield first;
    throw new TypeError("terminated", { cause });
  }
  return { body: Readable.from(chunks()), expectedBytes: first.length * 2 };
}

test("writes the body to a file under the given root and hands its path to use()", async () => {
  const data = gzipSync("line one\nline two\n");
  const seen = await withDownloadedFile(
    async () => bytesSource(data),
    async (path, info) => {
      assert.ok(path.startsWith(root), "lives under the injected tmp root");
      assert.deepEqual(await readFile(path), data);
      return info;
    },
    { tmpRoot: root, now: (() => { let t = 0; return () => (t += 500); })() },
  );
  assert.equal(seen.bytes, data.length);
  assert.equal(seen.ms, 500, "elapsed is measured with the injected clock");
});

test("removes the temp directory after a successful use()", async () => {
  await withDownloadedFile(async () => bytesSource(Buffer.from("ok")), async () => {}, {
    tmpRoot: root,
  });
  assert.deepEqual(await leftovers(), []);
});

test("removes the temp directory when use() throws, and rethrows that error", async () => {
  const boom = new Error("Upsert of 25 cards timed out");
  await assert.rejects(
    withDownloadedFile(async () => bytesSource(Buffer.from("ok")), async () => { throw boom; }, {
      tmpRoot: root,
    }),
    (e) => e === boom,
  );
  assert.deepEqual(await leftovers(), []);
});

test("removes the temp directory when the download drops partway", async () => {
  let usedIt = false;
  await assert.rejects(
    withDownloadedFile(
      async () => droppingSource(Buffer.from("partial")),
      async () => {
        usedIt = true;
      },
      { tmpRoot: root },
    ),
  );
  assert.equal(usedIt, false, "a broken download is never handed to the upsert");
  assert.deepEqual(await leftovers(), []);
});

test("removes the temp directory when opening the source fails", async () => {
  await assert.rejects(
    withDownloadedFile(
      async () => {
        throw new Error("Bulk download returned 503 Service Unavailable");
      },
      async () => {},
      { tmpRoot: root },
    ),
    /503/,
  );
  assert.deepEqual(await leftovers(), []);
});

test("rejects a file shorter than Content-Length before use() runs", async () => {
  let usedIt = false;
  await assert.rejects(
    withDownloadedFile(
      async () => bytesSource(Buffer.from("12345"), 9),
      async () => {
        usedIt = true;
      },
      { tmpRoot: root },
    ),
    (e: Error) => {
      assert.match(e.message, /received 5 of 9 bytes/);
      return true;
    },
  );
  assert.equal(usedIt, false);
  assert.deepEqual(await leftovers(), []);
});

test("a longer-than-promised body is also refused", async () => {
  await assert.rejects(
    withDownloadedFile(async () => bytesSource(Buffer.from("123456"), 4), async () => {}, {
      tmpRoot: root,
    }),
    /received 6 of 4 bytes/,
  );
});

test("skips the size check when the server gave no Content-Length", async () => {
  const out = await withDownloadedFile(
    async () => bytesSource(Buffer.from("abc"), null),
    async (_p, info) => info.bytes,
    { tmpRoot: root },
  );
  assert.equal(out, 3);
});

test("accepts a web ReadableStream body, as fetch returns", async () => {
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("web"));
      controller.close();
    },
  });
  const text = await withDownloadedFile(
    async () => ({ body: web, expectedBytes: 3 }),
    async (path) => (await readFile(path)).toString(),
    { tmpRoot: root },
  );
  assert.equal(text, "web");
});

test("two calls never share a path", async () => {
  const paths: string[] = [];
  const grab = async (path: string) => {
    paths.push(path);
  };
  await withDownloadedFile(async () => bytesSource(Buffer.from("a")), grab, { tmpRoot: root });
  await withDownloadedFile(async () => bytesSource(Buffer.from("a")), grab, { tmpRoot: root });
  assert.notEqual(paths[0], paths[1]);
});

test("a cleanup failure is reported, not thrown over the real result", async () => {
  const reported: string[] = [];
  const boom = new Error("Upsert of 25 cards timed out");
  await assert.rejects(
    withDownloadedFile(async () => bytesSource(Buffer.from("x")), async () => { throw boom; }, {
      tmpRoot: root,
      remove: async () => {
        throw new Error("EBUSY");
      },
      onCleanupError: (_e, dir) => reported.push(dir),
    }),
    (e) => e === boom,
  );
  assert.equal(reported.length, 1);
  // The injected remove did nothing, so tidy up the directory it left behind.
  await rm(reported[0], { recursive: true, force: true });
});

test("parseContentLength: numbers only, anything else is unknown", () => {
  assert.equal(parseContentLength("1234"), 1234);
  assert.equal(parseContentLength("0"), 0);
  assert.equal(parseContentLength(null), null);
  assert.equal(parseContentLength(undefined), null);
  assert.equal(parseContentLength(""), null);
  assert.equal(parseContentLength("abc"), null);
  assert.equal(parseContentLength("-5"), null);
  assert.equal(parseContentLength("1.5"), null);
});

// ---- retry classification ----------------------------------------------------

test("a short download is classified as a network error", () => {
  assert.equal(isTransientNetworkError(incompleteDownloadError(5, 9)), true);
});

test("a dropped download is classified as a network error", async () => {
  const error = await withDownloadedFile(
    async () => droppingSource(Buffer.from("partial")),
    async () => {},
    { tmpRoot: root },
  ).catch((e: unknown) => e);
  assert.equal(isTransientNetworkError(error), true);
});

test("a database failure inside use() is still not retried", async () => {
  let passes = 0;
  await assert.rejects(
    withRetry(
      () =>
        withDownloadedFile(async () => bytesSource(Buffer.from("ok")), async () => {
          passes += 1;
          throw new Error("Upsert of 25 cards timed out: canceling statement due to statement timeout");
        }, { tmpRoot: root }),
      { sleep: async () => {} },
    ),
  );
  assert.equal(passes, 1);
  assert.deepEqual(await leftovers(), []);
});

test("retry after a dropped download starts from a fresh, complete file", async () => {
  const good = gzipSync("the whole export");
  const paths: string[] = [];
  const contents: Buffer[] = [];
  let opens = 0;

  await withRetry(
    () =>
      withDownloadedFile(
        async () => {
          opens += 1;
          // First attempt drops mid-body; the second delivers everything.
          return opens === 1 ? droppingSource(good.subarray(0, 4)) : bytesSource(good);
        },
        async (path) => {
          paths.push(path);
          contents.push(await readFile(path));
          // The failed attempt's directory is already gone by now.
          assert.equal((await leftovers()).length, 1);
        },
        { tmpRoot: root },
      ),
    { sleep: async () => {} },
  );

  assert.equal(opens, 2, "re-downloaded rather than reusing anything");
  assert.equal(paths.length, 1);
  assert.deepEqual(contents[0], good, "the file the upsert sees is the complete one");
  assert.deepEqual(await leftovers(), []);
});
