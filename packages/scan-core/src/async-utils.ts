// Two small pure helpers the card details sheet needs so that a slow network
// can never leave it hanging: a deadline around any promise, and a bounded
// most-recently-used cache so reopening a card is instant. They live here, not
// in the app, so node's test runner can exercise them (the app has no tests).

export class TimeoutError extends Error {
  constructor(ms: number) { super(`Timed out after ${ms}ms`); this.name = 'TimeoutError'; }
}

/**
 * Rejects with TimeoutError if `work` has not settled in `ms`. The underlying
 * request is not cancelled (supabase-js calls here have their own longer abort
 * in backend.ts); this only stops the UI waiting on it. The timer is always
 * cleared so a fast result leaves nothing pending.
 */
export function rejectAfter<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    Promise.resolve(work).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * A Map that forgets its least recently used entry beyond `capacity`, and, when
 * `ttlMs` is given, any entry older than that. Age counts from `set`, not from
 * the last `get`: a card opened every few minutes must still pick up the daily
 * price sync, so reading an entry never extends its life. `now` is injectable
 * so the tests need no real waiting.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, { value: V; at: number }>();
  constructor(
    private readonly capacity: number,
    private readonly ttlMs?: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('LruCache capacity must be a positive integer');
    if (ttlMs !== undefined && !(ttlMs > 0)) throw new Error('LruCache ttlMs must be positive');
  }
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    if (this.ttlMs !== undefined && this.now() - e.at >= this.ttlMs) return undefined; // expired: dropped
    this.map.set(key, e); // re-insert: now the most recent
    return e.value;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as K);
  }
  delete(key: K): void { this.map.delete(key); }
  get size(): number { return this.map.size; }
}
