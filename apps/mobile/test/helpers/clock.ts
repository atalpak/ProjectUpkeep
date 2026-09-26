import { mock } from 'node:test';

// Freezes time for the whole test file and hands it back through `tick`.
//
// It has to be imported BEFORE the module under test, not enabled inside a
// test: cardDetails builds its caches at load, and `LruCache` captures
// `Date.now` as its default clock at construction. A clock installed later
// would never be seen by them, and the TTL tests would pass or fail on real
// wall time. `setTimeout` is mocked too, so the 8s / 10s deadlines are crossed
// by `tick`, not by waiting.
mock.timers.enable({ apis: ['setTimeout', 'Date'] });

export const tick = (ms: number): void => mock.timers.tick(ms);

/** Lets every already-resolved promise run (setImmediate is not mocked). */
export const flush = (): Promise<void> => new Promise<void>(resolve => setImmediate(resolve));
