/**
 * Recognising apply_stack_move's two "the decision went stale" refusals.
 *
 * These lived in packages/scan-core/src/move.ts while mobile was the only
 * caller. The web deck actions now call the same database function, and a
 * Next server action must not import scan-core (it is the scanner's package,
 * with React Native-shaped dependencies around it), so the predicates moved
 * here — pure string matching, no framework — and scan-core re-exports them.
 *
 * They match migration 38's message text rather than an error code because
 * both cases arrive as the same `no_data_found`; the wording is the only thing
 * that tells a stale SOURCE (the picked copy moved, was edited, dropped below
 * the requested quantity, or stopped being this account's) from a stale
 * DESTINATION target (the merge candidate moved, was edited, or stopped being
 * this account's). If migration 38's wording ever changes, these and their
 * tests change with it.
 *
 * Accepts `unknown` because the two callers hold different shapes: mobile
 * throws real Errors, while a server action holds PostgREST's plain
 * `{ message }` object or an already-extracted string.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function isStaleSourceError(error: unknown): boolean {
  return messageOf(error).includes("no longer matches what was decided");
}

export function isStaleDestinationTargetError(error: unknown): boolean {
  return messageOf(error).includes("no longer matches the decided target");
}
