/**
 * Deciding whether a failed sync pass is worth running again.
 *
 * On 2026-09-18 the scheduled sync died ~37MB into the download with
 * `SocketError: other side closed`. Nothing was wrong with the data or the
 * database; the connection simply dropped, and the next attempt a minute later
 * would very likely have gone through. There was no second attempt, so a
 * transient network blip cost a day of catalog freshness.
 *
 * The opposite mistake is worse. On 2026-09-16 and 09-17 the run failed on a
 * database statement timeout, and re-running *that* pass just loads a database
 * that is already struggling with another 118,000 rows. So this module retries
 * one class of failure only — the network dropping out from under the download
 * — and lets everything else fail on the first attempt with its real message.
 *
 * Restarting from the beginning is safe because every write is an upsert on
 * `cards.scryfall_id`, the primary key: replaying rows already written just
 * refreshes them.
 *
 * Kept out of scripts/sync-scryfall.ts, which runs `main()` on import, so the
 * policy can be tested with an injected sleep and clock rather than by waiting.
 */

/** Codes that mean "the connection went away", not "the request was wrong". */
const NETWORK_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ERR_STREAM_PREMATURE_CLOSE",
  // A socket closed cleanly mid-gzip surfaces as a truncated stream; a truly
  // corrupt file just fails the same way three times, which is acceptable.
  "Z_BUF_ERROR",
]);

/** undici surfaces a dropped download as a bare TypeError with these messages. */
const NETWORK_MESSAGE = /^terminated$|fetch failed|other side closed|socket hang up/i;

/**
 * The upsert path wraps its failures as "Upsert of N cards …". Those are
 * database-side even when the underlying text says "fetch failed" (supabase-js
 * reports an unreachable API that way), and re-running the pass would only add
 * load. Checked first so it always wins.
 */
const DATABASE_MESSAGE = /^Upsert of \d+ cards|statement timeout|canceling statement/i;

/** Walks `error.cause` — undici nests the socket error two levels down. */
function* causeChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

export function isTransientNetworkError(error: unknown): boolean {
  let network = false;
  for (const link of causeChain(error)) {
    const { code, message } = link as { code?: unknown; message?: unknown };
    const text = typeof message === "string" ? message : "";
    if (DATABASE_MESSAGE.test(text) || code === "57014") return false;
    if (typeof code === "string" && NETWORK_CODES.has(code)) network = true;
    if (NETWORK_MESSAGE.test(text)) network = true;
  }
  return network;
}

export type RetryOptions = {
  /** Total attempts, first included. */
  maxAttempts?: number;
  /** Wait before attempt 2, attempt 3, … The last entry repeats if needed. */
  backoffMs?: number[];
  /**
   * Wall-clock allowance for the whole thing. A retry is only started if the
   * wait plus another pass of the length the last one took still fits, so a
   * retry can never run the job into the workflow's own timeout, which would
   * kill the process with the run row still `running`.
   */
  budgetMs?: number;
  isRetryable?: (error: unknown) => boolean;
  /** Injected so tests neither wait nor depend on the real clock. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { attempt: number; nextAttempt: number; waitMs: number; error: unknown }) => void;
  onGiveUp?: (info: { attempt: number; reason: string; error: unknown }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `pass` until it succeeds, throws something not worth retrying, or runs
 * out of attempts or time. Gives up by rethrowing the *last* error unchanged,
 * so the caller records what actually went wrong on the final try.
 *
 * `pass` receives the attempt number and is responsible for starting from a
 * clean slate (fresh counters, fresh download) each time it is called.
 */
export async function withRetry<T>(
  pass: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    backoffMs = [15_000, 45_000],
    budgetMs = Number.POSITIVE_INFINITY,
    isRetryable = isTransientNetworkError,
    sleep = defaultSleep,
    now = Date.now,
    onRetry = () => {},
    onGiveUp = () => {},
  } = options;

  const startedAt = now();

  for (let attempt = 1; ; attempt += 1) {
    const passStartedAt = now();
    try {
      return await pass(attempt);
    } catch (error) {
      if (!isRetryable(error)) {
        if (attempt > 1) onGiveUp({ attempt, reason: "error is not a network failure", error });
        throw error;
      }
      if (attempt >= maxAttempts) {
        onGiveUp({ attempt, reason: `${maxAttempts} attempts used`, error });
        throw error;
      }

      const waitMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      const passMs = now() - passStartedAt;
      const elapsed = now() - startedAt;
      if (elapsed + waitMs + passMs > budgetMs) {
        onGiveUp({ attempt, reason: "not enough time left for another pass", error });
        throw error;
      }

      onRetry({ attempt, nextAttempt: attempt + 1, waitMs, error });
      await sleep(waitMs);
    }
  }
}
