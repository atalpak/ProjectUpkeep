/**
 * The signup invite gate.
 *
 * Signup is **open by default**. Setting `SIGNUP_INVITE_CODE` turns on a
 * required-code gate — deliberately the smallest thing that works: a single
 * shared code, read from that variable in the signup action. Per-invite rows,
 * single-use codes and an email allowlist are a heavier change left for later.
 *
 * This module doesn't decide open-vs-gated — that's the caller's call, made
 * once from the raw env value (`signupInviteDecision`, used by `signUp`).
 * `inviteCodeAccepted` is just the comparison used once a code is configured.
 */

/**
 * Does `input` match the configured invite code?
 *
 * Both sides are trimmed, so a code pasted with stray whitespace still works.
 * Returns `false` when `expected` is unset or trims to empty — defensive only:
 * callers are expected to check `signupInviteDecision` first and never reach
 * here in open mode.
 */
export function inviteCodeAccepted(
  input: string,
  expected: string | undefined,
): boolean {
  const target = expected?.trim();
  if (!target) return false;
  return input.trim() === target;
}

/**
 * The whole open/accept/reject decision, from the raw `SIGNUP_INVITE_CODE`
 * value and what the visitor typed. Pulled out as a pure function so the
 * two-state rule — unset or whitespace-only means open, regardless of
 * `inviteInput` — is one thing to test, not something re-derived by reading
 * `signUp`.
 */
export function signupInviteDecision(
  inviteInput: string,
  rawExpected: string | undefined,
): "open" | "accept" | "reject" {
  const target = rawExpected?.trim();
  if (!target) return "open";
  return inviteCodeAccepted(inviteInput, target) ? "accept" : "reject";
}
