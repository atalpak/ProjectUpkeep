/**
 * The trading-terms version, and the one comparison both apps make with it.
 *
 * Only the version and the acceptance check are shared. Each app keeps its own
 * status shape (the web reads snake_case rows, mobile camelCase) and its own
 * enforcement sentence, which names a different place to accept. The version is
 * compared verbatim, so two copies that drift show up as a gate that never
 * clears -- which is why there is now one.
 */

/**
 * ISO date of the current terms. Change this whenever the terms text changes
 * in a way that matters; bumping it forces everyone to re-accept on their next
 * attempt to trade.
 */
export const CURRENT_TOS_VERSION = "2026-09-01";

/** True only when something was accepted and it was the version now in force. */
export function acceptedCurrentTos(acceptedAt: string | null, version: string | null): boolean {
  return acceptedAt !== null && version === CURRENT_TOS_VERSION;
}
