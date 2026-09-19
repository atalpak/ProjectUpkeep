import { CURRENT_TOS_VERSION, acceptedCurrentTos } from '@upkeep/domain';
import { backend } from './backend';

// The trading-terms gate, mirrored from src/lib/social/tos.ts and the
// acceptTos action in src/app/(app)/friends/actions.ts.
//
// The version string and the acceptance comparison come from @upkeep/domain,
// shared with the web, so a bump is one edit and the two clients cannot disagree
// about what counts as accepted. The status shape and the enforcement sentence
// stay local: the sentence names this app's place to accept, not the web's.
//
// Acceptance is a self-attestation written to the caller's own profiles row
// ("profiles: update own"); no RPC and no new policy is involved.

export { CURRENT_TOS_VERSION };

export type TosStatus = { acceptedAt: string | null; version: string | null };

export function hasAcceptedTos(status: TosStatus | null): boolean {
  return !!status && acceptedCurrentTos(status.acceptedAt, status.version);
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
