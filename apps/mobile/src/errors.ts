// Extracted from App.tsx's monolith so every screen (not just the scan flow)
// can turn a raw error into the same user-facing copy. Mirrors
// src/app/(app)/collection/actions.ts's friendlyDbError on the web side —
// see that file's header for why the trigger messages need translating at
// all: they are precise but written for whoever is reading the schema, not
// someone mid-scan or mid-sleeve.
export function friendlyDbMessage(message: string): string {
  if (message.includes('must belong to owner_user_id')) {
    return 'That destination is no longer yours. Refresh and choose another.';
  }
  // apply_stack_move (migration 38) retries a stale destination target, and a
  // stale source, once each automatically (packages/scan-core/src/move.ts) —
  // reaching here means both attempts failed, so the honest message is "this
  // needs a fresh look", not "try the exact same thing again".
  if (message.includes('no longer matches what was decided')) {
    return 'That copy changed since you picked it — close this and pick again.';
  }
  if (message.includes('no longer matches the decided target')) {
    return 'That stack changed while this was in flight. Close this and try again.';
  }
  return message;
}

export const errorMessage = (e: unknown) =>
  friendlyDbMessage(e instanceof Error ? e.message : (e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Something went wrong. Please retry.'));
