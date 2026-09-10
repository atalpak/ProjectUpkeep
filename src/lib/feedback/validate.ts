/**
 * The pure half of the feedback form.
 *
 * `sendFeedback` in src/app/(app)/feedback-actions.ts carries "use server" and
 * so may only export async functions — the same constraint that split
 * collection/action-state.ts out from its actions. The input check, the
 * friendly wording for a database rejection, and the `useActionState` shape all
 * need to be importable from a client component and a unit test too, so they
 * live here.
 *
 * The limits mirror migration 29's feedback_body_length / feedback_page_length
 * checks, so an over-long message is turned away with a sentence before it
 * costs a round trip. `page` is our value, not the user's — an absent or
 * over-long one is dropped rather than rejected.
 */

/** Mirrors the 4000 in migration 29's feedback_body_length check. */
export const MAX_BODY_LENGTH = 4000;
/** Mirrors the 300 in migration 29's feedback_page_length check. */
export const MAX_PAGE_LENGTH = 300;

export type FeedbackFields = { body: string; page: string | null };

/**
 * Normalise and check what the form submitted. The trim is JS `.trim()`, which
 * also strips \t\n\r\f\v — so an all-newline body is rejected the same as an
 * all-space one, matching migration 29's `body ~ '\S'` backstop.
 */
export function validateFeedback(
  rawBody: unknown,
  rawPage: unknown,
): FeedbackFields | { error: string } {
  const body = String(rawBody ?? "").trim();
  if (body === "") return { error: "Type a little something first." };
  if (body.length > MAX_BODY_LENGTH) {
    return {
      error: `Keep it under ${MAX_BODY_LENGTH.toLocaleString()} characters.`,
    };
  }

  const page = String(rawPage ?? "").trim();
  return {
    body,
    page: page === "" || page.length > MAX_PAGE_LENGTH ? null : page,
  };
}

/**
 * Check-constraint name → the sentence to show if that constraint still fires
 * on the write. The client check above should have caught it, but a race or a
 * caller that skips validation can get through, and a raw Postgres string is
 * not something to put in front of a user.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  feedback_body_length: `Keep it between 1 and ${MAX_BODY_LENGTH.toLocaleString()} characters.`,
};

/** Friendly text for a Supabase insert error: a known constraint gets its
 *  sentence, anything else gets a generic line rather than the DB's own. */
export function feedbackErrorMessage(
  dbMessage: string | null | undefined,
): string {
  for (const [name, message] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (dbMessage?.includes(name)) return message;
  }
  return "Couldn't send that — try again.";
}

/** Form state for `useActionState`. Here rather than in the "use server" action
 *  module, which may only export async functions. */
export type FeedbackState = {
  error: string | null;
  notice: string | null;
  /** Changes on every success, so the form knows to show its thank-you state. */
  nonce?: string;
};

export const EMPTY_FEEDBACK_STATE: FeedbackState = { error: null, notice: null };
