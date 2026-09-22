/**
 * How the catalog export walks `public.cards`, and what it does when a page
 * times out.
 *
 * On 2026-09-20 and 09-21 the daily sync upserted all 118,609 printings fine
 * and then the export step died with `canceling statement due to statement
 * timeout` at offset 58,000 (after 50,000 rows had gone through quickly). The
 * old loop paged with `.range(offset)` under an `order by scryfall_id` and two
 * OR filters. `OFFSET n` makes Postgres produce and discard the first n
 * matching rows on every request, so page k costs k times what page 1 did and
 * the run gets slower the deeper it goes until one page crosses PostgREST's
 * statement timeout. Nothing was wrong with the data.
 *
 * Keyset paging removes that: each page asks for `scryfall_id > <last id
 * seen>`, which the primary-key index (migration 3) turns into a seek, so every
 * page costs the same however deep it is. The filters still run per row, but
 * only over the rows of one page's worth of index walk, not everything before it.
 *
 * Retrying is limited to statement timeouts and to a handful of short waits. A
 * page that timed out once usually succeeds moments later (the sync's own
 * upserts may still be vacuuming), whereas `sync-retry.ts` deliberately does
 * NOT retry the write path, because re-running 118,000 upserts against a
 * struggling database makes it worse. One page is a cheap read, so the
 * arithmetic is the opposite here. Any other error fails immediately with its
 * own message.
 *
 * Kept out of scripts/export-catalog.ts, which reads argv and env at the top
 * level and runs `main()` on import, so the loop can be tested with an
 * injected fetcher and sleep.
 */

export type CardRow = Record<string, unknown> & { scryfall_id: string };

/** Fetches up to `pageSize` rows with `scryfall_id > after`, ordered by it. */
export type FetchPage = (after: string | null) => Promise<CardRow[]>;

const TIMEOUT_MESSAGE = /statement timeout|canceling statement/i;

export function isStatementTimeout(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return code === "57014" || (typeof message === "string" && TIMEOUT_MESSAGE.test(message));
}

export type PagingOptions = {
  pageSize: number;
  /** Waits before retry 1, 2, …; its length is the number of retries per page. */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { after: string | null; retry: number; waitMs: number; error: unknown }) => void;
  onProgress?: (rowsSoFar: number) => void;
  /** Stops early once this many rows are collected; for smoke runs. */
  limit?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  fetchPage: FetchPage,
  after: string | null,
  backoffMs: number[],
  sleep: (ms: number) => Promise<void>,
  onRetry: NonNullable<PagingOptions["onRetry"]>,
): Promise<CardRow[]> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await fetchPage(after);
    } catch (error) {
      if (!isStatementTimeout(error) || retry >= backoffMs.length) throw error;
      const waitMs = backoffMs[retry];
      onRetry({ after, retry: retry + 1, waitMs, error });
      await sleep(waitMs);
    }
  }
}

/**
 * Collects every row, page by page. A short page means the end, same as the
 * old loop. Errors propagate unchanged so the caller can say where it stopped.
 */
export async function collectAllRows(
  fetchPage: FetchPage,
  options: PagingOptions,
): Promise<CardRow[]> {
  const {
    pageSize,
    backoffMs = [2_000, 5_000, 15_000],
    sleep = defaultSleep,
    onRetry = () => {},
    onProgress = () => {},
    limit = Number.POSITIVE_INFINITY,
  } = options;

  const rows: CardRow[] = [];
  let after: string | null = null;
  let page = 0;

  while (rows.length < limit) {
    const data = await fetchWithRetry(fetchPage, after, backoffMs, sleep, onRetry);
    if (data.length === 0) break;

    rows.push(...data);
    const lastId: unknown = data[data.length - 1].scryfall_id;
    // A missing key would make the next page start over from the beginning and
    // loop forever; fail loudly instead.
    if (typeof lastId !== "string" || (after !== null && lastId <= after)) {
      throw new Error(`Page did not advance the keyset cursor (after=${after}, last=${String(lastId)})`);
    }
    after = lastId;

    page++;
    if (page % 50 === 0) onProgress(rows.length);
    if (data.length < pageSize) break;
  }

  return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
}
