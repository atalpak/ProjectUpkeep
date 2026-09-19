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

/** A Map that forgets its least recently used entry beyond `capacity`. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('LruCache capacity must be a positive integer');
  }
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, v); // re-insert: now the most recent
    return v;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as K);
  }
  delete(key: K): void { this.map.delete(key); }
  get size(): number { return this.map.size; }
}
