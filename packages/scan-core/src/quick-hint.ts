import type { Candidate } from './types';
import type { QuickMatch } from './band';

/**
 * What quick scan says when it rejects a read. The old line ("Couldn't read that
 * clearly") could not tell an OCR failure from a match failure, so the person
 * (and the developer) had no way to know whether to change the light or the
 * catalog. Each hint now names what was read, and the wording separates the
 * three ways a read fails: no text at all, a name too far from any card, or two
 * cards that fit equally well.
 *
 * A rejected read is retried by the scanner without the card being taken away
 * (the `retryToken` prop), so the messages are calm and describe a retry in
 * progress rather than an error. After `QUICK_RETRY_CAP` automatic tries in one
 * hold the message changes to advice; the retries themselves carry on.
 */
export const QUICK_RETRY_CAP = 4;
export const QUICK_HINT_TITLE_CHARS = 28;

export const QUICK_GIVE_UP_HINT = 'Couldn’t read that card — try more light or a bit further away';

/** The first two OCR lines as one trimmed string, or '' when nothing legible was read. */
export function readTitle(lines: readonly string[], max = QUICK_HINT_TITLE_CHARS): string {
  const text = lines.slice(0, 2).map(l => l.trim()).filter(Boolean).join(' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type QuickRejection = Extract<QuickMatch, { ok: false }>['reason'];

/** `attempt` is how many automatic retries this hold has already had (0 on the first rejection). */
export function quickRejectionHint(reason: QuickRejection, lines: readonly string[], attempt: number): string {
  if (attempt >= QUICK_RETRY_CAP) return QUICK_GIVE_UP_HINT;
  const title = readTitle(lines);
  if (!title) return 'No text found on the card — hold steady, trying again';
  switch (reason) {
    case 'ambiguous': return `Read “${title}” — two cards fit, trying again`;
    case 'weak': return `Read “${title}” — not sure of it, trying again`;
    case 'none': return `Read “${title}” — no match, trying again`;
  }
}

/** Dev-only diagnostic: what was read and how the top candidate scored. */
export function describeRejection(reason: QuickRejection, lines: readonly string[], candidates: readonly Candidate[]): Record<string, unknown> {
  const top = candidates[0];
  return { reason, title: readTitle(lines, 60), top: top ? { name: top.printing.name, score: Number(top.score.toFixed(3)), evidence: top.evidence } : null, candidates: candidates.length };
}
