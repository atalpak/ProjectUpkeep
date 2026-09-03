/**
 * The trading terms, and whether a user has accepted the current version.
 *
 * A plain module — no "use server", no server-only — because both the server
 * actions that enforce acceptance and the client panel that collects it need
 * the version string and the check.
 *
 * The charter is blunt about why this exists: the operator is not a party to
 * any peer trade and is not liable for one, and that has to be accepted
 * explicitly rather than buried. Bumping CURRENT_TOS_VERSION forces everyone to
 * re-accept on their next attempt to trade.
 */

/**
 * ISO date of the current terms. Change this whenever docs/... terms text
 * changes in a way that matters; the value is compared verbatim.
 */
export const CURRENT_TOS_VERSION = "2026-09-01";

/** What we store per user about their acceptance. */
export type TosStatus = {
  accepted_at: string | null;
  version: string | null;
};

/** True only when the user has accepted the version currently in force. */
export function hasAcceptedTos(status: TosStatus | null | undefined): boolean {
  return (
    !!status &&
    status.accepted_at !== null &&
    status.version === CURRENT_TOS_VERSION
  );
}

/**
 * Whether to show the acceptance gate.
 *
 * `null` means we could not read acceptance at all — the columns are missing
 * because migration 00000000000012 has not run. In that state the gate would be
 * a dead end (accepting also fails), so it is not shown and trading behaves as
 * it did before the feature. A real row that simply is not accepted does gate.
 */
export function shouldGateTrading(status: TosStatus | null | undefined): boolean {
  return status != null && !hasAcceptedTos(status);
}

/** Whether the user is clear to propose/accept — accepted, or cannot be gated yet. */
export function tradingAllowed(status: TosStatus | null | undefined): boolean {
  return status == null || hasAcceptedTos(status);
}

/** The one sentence that has to be true before a trade can happen. */
export const TOS_ENFORCEMENT_MESSAGE =
  "Accept the trading terms on the Friends page before proposing or accepting a trade.";
