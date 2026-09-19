import { backend } from './backend';

// The trading-terms gate, mirrored from src/lib/social/tos.ts and the
// acceptTos action in src/app/(app)/friends/actions.ts.
//
// This is a second copy on purpose: the web module lives under src/ (a Next
// path alias the app cannot import) and is not in @upkeep/domain, and a
// version string is small enough that the cost of keeping two in step is less
// than the cost of moving it in a change that is not about terms. THE TWO
// VERSIONS MUST MATCH -- bump both together, or one client will keep asking
// people to re-accept what the other already recorded. The value is compared
// verbatim, so a mismatch shows up as a gate that never clears.
//
// Acceptance is a self-attestation written to the caller's own profiles row
// ("profiles: update own"); no RPC and no new policy is involved.

export const CURRENT_TOS_VERSION = '2026-09-01';

export type TosStatus = { acceptedAt: string | null; version: string | null };

export function hasAcceptedTos(status: TosStatus | null): boolean {
  return !!status && status.acceptedAt !== null && status.version === CURRENT_TOS_VERSION;
}

/**
 * Whether the user is clear to propose or accept. `null` means acceptance could
 * not be read at all (the tos_ columns from migration 12 are missing): gating
 * then would be a dead end, since accepting fails too, so trading is allowed --
 * the same tolerance the web has.
 */
export function tradingAllowed(status: TosStatus | null): boolean {
  return status === null || hasAcceptedTos(status);
}

export const TOS_ENFORCEMENT_MESSAGE = 'Accept the trading terms before proposing or accepting a trade.';

export async function fetchTosStatus(userId: string): Promise<TosStatus | null> {
  if (!backend) return null;
  const { data, error } = await backend.from('profiles').select('tos_accepted_at,tos_version').eq('id', userId).maybeSingle();
  if (error) return null;
  return { acceptedAt: (data?.tos_accepted_at as string | null) ?? null, version: (data?.tos_version as string | null) ?? null };
}

export async function acceptTos(userId: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('profiles').update({ tos_accepted_at: new Date().toISOString(), tos_version: CURRENT_TOS_VERSION }).eq('id', userId);
  if (error) throw new Error(error.message);
}
