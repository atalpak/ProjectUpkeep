"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { SocialState } from "@/app/(app)/social-state";
import { CURRENT_TOS_VERSION } from "@/lib/social/tos";

/**
 * Friend requests.
 *
 * Almost nothing is validated here, and that is deliberate: the rules live in
 * the policies from migration 9. You may only insert a request as yourself, only
 * the addressee may accept, and either side may remove. An action that
 * re-checked those in TypeScript would be a second copy of the rule, free to
 * drift from the one that actually protects the data.
 *
 * What this layer does own is turning a database error into a sentence.
 */

function fail(message: string): SocialState {
  return { error: message, notice: null };
}

function ok(message: string): SocialState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

function revalidate() {
  revalidatePath("/friends");
  revalidatePath("/dashboard");
  revalidatePath("/trades");
}

/**
 * Records that the signed-in user accepts the current trading terms.
 *
 * A self-attestation: the "profiles: update own" policy already lets a user
 * write their own row, and what they are asserting is about themselves. Storing
 * the version means a later change to the terms forces a fresh acceptance
 * rather than silently standing on the old one.
 */
export async function acceptTos(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  // The version the user actually saw, echoed back by the form. If the page was
  // open across a terms change, this will not match and we ask them to reload
  // rather than record acceptance of wording they never read.
  const seenVersion = String(formData.get("version") ?? "");
  if (seenVersion !== CURRENT_TOS_VERSION) {
    return fail("The terms were updated. Reload the page and read them again.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      tos_accepted_at: new Date().toISOString(),
      tos_version: CURRENT_TOS_VERSION,
    })
    .eq("id", user.id);

  if (error) {
    if (/column .*tos_/.test(error.message)) {
      return fail(
        "Terms acceptance is not set up on the database yet — apply migration " +
          "00000000000012 and try again.",
      );
    }
    return fail(error.message);
  }

  revalidate();
  return ok("Trading terms accepted.");
}

export async function sendFriendRequest(
  _prev: SocialState,
  formData: FormData,
): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const addresseeId = String(formData.get("addressee_id") ?? "").trim();
  if (!addresseeId) return fail("Pick someone to add.");
  if (addresseeId === user.id) return fail("You cannot add yourself.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: user.id, addressee_id: addresseeId, status: "pending" });

  if (error) {
    // The unique index is on the ordered pair, so this fires whether they
    // already asked you or you already asked them.
    if (error.message.includes("duplicate key") || error.code === "23505") {
      return fail("There is already a request between you two.");
    }
    return fail(error.message);
  }

  revalidate();
  return ok("Request sent.");
}

export async function acceptFriendRequest(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const id = String(formData.get("friendship_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  // Only the addressee can do this, enforced by policy rather than here.
  await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);

  revalidate();
}

/**
 * Declines a request, or unfriends someone.
 *
 * Both are a delete. A declined request leaves no tombstone, so the pair can
 * ask again later — and so nobody can tell the difference between "declined"
 * and "never asked".
 */
export async function removeFriendship(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const id = String(formData.get("friendship_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("friendships").delete().eq("id", id);

  revalidate();
}

/**
 * Marks a location as open for trade, or closes it.
 *
 * This is the only switch that makes any card visible to another person, so it
 * lives with the social actions rather than with location management — the
 * point of the setting is social, even though the row is a container.
 */
export async function setLocationTradable(formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;

  const locationId = String(formData.get("location_id") ?? "").trim();
  const tradable = String(formData.get("is_tradable") ?? "") === "true";
  if (!locationId) return;

  const supabase = await createClient();
  await supabase.from("locations").update({ is_tradable: tradable }).eq("id", locationId);

  revalidatePath("/locations");
  revalidatePath("/friends");
  revalidatePath("/trades");
}
