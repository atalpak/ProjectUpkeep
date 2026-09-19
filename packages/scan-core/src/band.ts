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

/**
 * Quick scan (hold Scan, slide to Scan, a camera box opens and the first
 * decent read opens the card's details) has no review step in front of it, so
 * it must be stricter than the scanner's three-way band: `uncertain` covers
 * fuzzy name matches down to a 0.45 similarity, which is how a misread title
 * turned into a different card.
 *
 * A read is accepted only when the top name is an exact match or a very close
 * one, and no *other* card is nearly as good a fit. Otherwise it is rejected
 * and the caller asks for another look.
 *
 * `exactPrinting` says whether the set code and collector number were read
 * too. Only then is the specific printing trustworthy; a name-only match
 * carries an arbitrary printing of that card, so the caller should not pin it.
 */
export const QUICK_MIN_SCORE = 0.85;
export const QUICK_AMBIGUITY_MARGIN = 0.05;

export type QuickMatch =
  | { ok: true; printing: Candidate['printing']; exactPrinting: boolean }
  | { ok: false; reason: 'none' | 'weak' | 'ambiguous' };

/**
 * The two cutoffs are a parameter only so `scripts/accuracy.ts` can sweep them
 * against labelled reads; the app never passes it, so shipped behaviour is the
 * constants above and nothing else.
 */
export interface QuickLimits { minScore: number; ambiguityMargin: number }

export function quickMatch(candidates: Candidate[], limits: QuickLimits = { minScore: QUICK_MIN_SCORE, ambiguityMargin: QUICK_AMBIGUITY_MARGIN }): QuickMatch {
  if (!candidates.length) return { ok: false, reason: 'none' };
  const top = candidates[0]!;
  if (top.score < limits.minScore) return { ok: false, reason: 'weak' };
  // An exact printing (set + number read and matched) or a perfect name is
  // not something a neighbour can out-argue.
  const exactPrinting = top.evidence === 'printing';
  if (top.score < 1 && !exactPrinting) {
    const rival = candidates.find(c => c.printing.oracleId !== top.printing.oracleId && c.score >= top.score - limits.ambiguityMargin);
    if (rival) return { ok: false, reason: 'ambiguous' };
  }
  return { ok: true, printing: top.printing, exactPrinting };
}
