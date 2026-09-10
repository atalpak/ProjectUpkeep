"use server";

import {
  feedbackErrorMessage,
  validateFeedback,
  type FeedbackState,
} from "@/lib/feedback/validate";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * In-app feedback.
 *
 * The first way a real user tells us anything. One free-text box, plus the
 * route they were on for triage context — no category picker, no severity, no
 * "expected vs actual". Asking for structure before we know what people send
 * would just be fields left blank.
 *
 * The row is written as the signed-in user: `user_id` defaults to `auth.uid()`
 * in migration 29 and the INSERT policy pins it there, so this layer never
 * passes it. Input checking and the friendly wording for a DB rejection live in
 * src/lib/feedback/validate.ts, where a unit test can reach them; this file is
 * the auth guard and the insert.
 */

function fail(message: string): FeedbackState {
  return { error: message, notice: null };
}

function ok(message: string): FeedbackState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

export async function sendFeedback(
  _prev: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const fields = validateFeedback(formData.get("body"), formData.get("page"));
  if ("error" in fields) return fail(fields.error);

  const supabase = await createClient();
  const { error } = await supabase.from("feedback").insert(fields);
  if (error) return fail(feedbackErrorMessage(error.message));

  return ok("Thanks — that landed. We read every note.");
}
