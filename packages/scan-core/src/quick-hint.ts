import type { Candidate } from './types';
import type { QuickMatch } from './band';

/**
 * What quick scan says when it rejects a read: nothing, at first. The scanner
 * retries a rejected read without the card being taken away (the `retryToken`
 * prop), and a message about what was read or why it failed is internal detail
 * the person cannot act on (and showed body text as if it were the title). So
 * the first `QUICK_RETRY_CAP` tries are silent, the live coaching line keeps
 * saying "Hold steady", and only repeated failure earns advice that helps: more
 * light, or less glare, alternating. The retries themselves carry on. What was
 * read stays available to developers through `describeRejection`.
 */
export const QUICK_RETRY_CAP = 4;
export const QUICK_HINT_TITLE_CHARS = 28;

export const QUICK_LIGHT_HINT = 'Try more light';
export const QUICK_GLARE_HINT = 'Tilt the card to reduce glare';

/** The first two OCR lines as one trimmed string, or '' when nothing legible was read. Dev diagnostics only. */
export function readTitle(lines: readonly string[], max = QUICK_HINT_TITLE_CHARS): string {
  const text = lines.slice(0, 2).map(l => l.trim()).filter(Boolean).join(' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type QuickRejection = Extract<QuickMatch, { ok: false }>['reason'];

/**
 * `attempt` is how many automatic retries this hold has already had (0 on the
 * first rejection). '' means show nothing beyond the live coaching line.
 */
export function quickRejectionHint(attempt: number): string {
  if (attempt < QUICK_RETRY_CAP) return '';
  return (attempt - QUICK_RETRY_CAP) % 2 === 0 ? QUICK_LIGHT_HINT : QUICK_GLARE_HINT;
}

/** Dev-only diagnostic: what was read and how the top candidate scored. */
export function describeRejection(reason: QuickRejection, lines: readonly string[], candidates: readonly Candidate[]): Record<string, unknown> {
  const top = candidates[0];
  return { reason, title: readTitle(lines, 60), top: top ? { name: top.printing.name, score: Number(top.score.toFixed(3)), evidence: top.evidence } : null, candidates: candidates.length };
}
