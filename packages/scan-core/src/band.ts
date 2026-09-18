import type { Candidate } from './types';

/**
 * Every scan resolves to `needsReview: true` (see pipeline.ts's header) —
 * there is no auto-accept path anywhere in this package. A UI still needs to
 * tell three genuinely different situations apart (a strong top match worth
 * visually elevating, a flat list worth a plain "verify" prompt, and no match
 * at all), so that classification is pulled out here rather than inlined at
 * each call site (apps/mobile's ScanScreen today, potentially a web scanner
 * later) — the threshold is product policy shared across platforms, not a
 * per-screen decision.
 */
export type ScanBand = 'confident' | 'uncertain' | 'none';

/** Mirrors the >= 0.78 "good enough to skip a second recognition pass"
 * threshold pipeline.ts already uses to decide whether to spend a second
 * (image) recognition pass — reused here as "good enough to visually
 * elevate", not redefined with its own number. */
export const CONFIDENT_SCORE_THRESHOLD = 0.78;

export function scanBand(candidates: Candidate[]): ScanBand {
  if (!candidates.length) return 'none';
  const top = candidates[0]!;
  if (top.evidence === 'printing' && top.score >= CONFIDENT_SCORE_THRESHOLD) return 'confident';
  return 'uncertain';
}
