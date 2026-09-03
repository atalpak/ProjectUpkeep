"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { SocialState } from "@/app/(app)/social-state";
import { TOS_ENFORCEMENT_MESSAGE, hasAcceptedTos } from "@/lib/social/tos";
import { expiryFromNow } from "@/lib/social/trade-status";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The trade lifecycle.
 *
 * Proposing and closing are ordinary writes, bounded by the policies. Accepting
 * is not: it moves cards between accounts, and card_instances RLS forbids any
 * client from changing owner_user_id. That transfer happens inside
 * accept_trade() in migration 9, in one transaction with the audit rows, and
 * this action does nothing but call it and translate what comes back.
 *
 * One thing this layer does own, because the database cannot: the charter
 * requires the trading terms to be accepted before anyone proposes or accepts a
 * trade. That is a product rule about a disclaimer, not a data-integrity rule,
 * so it is checked here rather than in a policy.
 */

function fail(message: string): SocialState {
  return { error: message, notice: null };
}

function ok(message: string): SocialState {
  return { error: null, notice: message, nonce: crypto.randomUUID() };
}

function revalidate(tradeId?: string) {
  revalidatePath("/trades");
  revalidatePath("/friends");
  revalidatePath("/collection");
  revalidatePath("/dashboard");
  if (tradeId) revalidatePath(`/trades/${tradeId}`);
}

/**
 * Has this user accepted the current trading terms?
 *
 * Tolerates migration 00000000000012 not being applied: if the columns are
 * missing the query errors, and this returns true (cannot tell → do not block),
 * matching getMyTosStatus. Once the migration lands, an un-accepted user is
 * turned away here.
 */
async function hasAcceptedTerms(supabase: Supabase, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tos_accepted_at, tos_version")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (!/column .*tos_/.test(error.message)) {
      console.error("Could not check terms acceptance:", error.message);
    }
    return true;
  }

  return hasAcceptedTos({
    accepted_at: (data?.tos_accepted_at as string | null) ?? null,
    version: (data?.tos_version as string | null) ?? null,
  });
}

type OfferedCard = { instanceId: string; quantity: number; direction: "mine" | "theirs" };

/** Reads the two hidden fields the proposal form submits. */
function readOffer(formData: FormData): OfferedCard[] {
  const parse = (field: string, direction: OfferedCard["direction"]): OfferedCard[] =>
    String(formData.get(field) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        // "instanceId:quantity"
        const [instanceId, rawQuantity] = entry.split(":");
        const quantity = Number.parseInt(rawQuantity ?? "1", 10);
        return {
          instanceId,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          direction,
        };
      })
      .filter((o) => o.instanceId);

  return [...parse("offering", "mine"), ...parse("requesting", "theirs")];
}

export async function proposeTrade(
  _prev: SocialState,
  formData: FormData,
): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const recipientId = String(formData.get("recipient_id") ?? "").trim();
  if (!recipientId) return fail("Who is this trade with?");

  const offer = readOffer(formData);
  if (offer.length === 0) return fail("Add at least one card to the trade.");

  const supabase = await createClient();

  if (!(await hasAcceptedTerms(supabase, user.id))) return fail(TOS_ENFORCEMENT_MESSAGE);

  // A counter-offer: this proposal is meant to replace one the current user
  // received. Validate that before writing anything, so a stale link cannot
  // leave two live trades pointing at the same cards.
  const counterOf = String(formData.get("counter_of") ?? "").trim() || null;
  if (counterOf) {
    const { data: original, error: originalError } = await supabase
      .from("trades")
      .select("id, proposer_id, recipient_id, status")
      .eq("id", counterOf)
      .maybeSingle();

    if (originalError) return fail(originalError.message);
    if (
      !original ||
      original.recipient_id !== user.id ||
      !["proposed", "countered"].includes(original.status as string)
    ) {
      return fail(
        "That offer can't be countered any more — it may have been accepted, declined, or withdrawn.",
      );
    }
    if (original.proposer_id !== recipientId) {
      return fail("A counter-offer has to go back to the person who made the original offer.");
    }
  }

  // The insert policy re-checks that these two are friends, so a proposal to a
  // stranger fails here rather than being caught by a check we wrote ourselves.
  //
  // countered_from is only set on the insert when this actually is a counter:
  // an ordinary proposal never names the column, so it keeps working even if
  // migration 00000000000012 has not been applied yet.
  const { data: trade, error: tradeError } = await supabase
    .from("trades")
    .insert({
      proposer_id: user.id,
      recipient_id: recipientId,
      status: "proposed",
      expires_at: expiryFromNow(),
      ...(counterOf ? { countered_from: counterOf } : {}),
    })
    .select("id")
    .single();

  if (tradeError) {
    if (tradeError.code === "42501" || tradeError.message.includes("row-level security")) {
      return fail("You can only trade with people you are friends with.");
    }
    return fail(tradeError.message);
  }

  const { error: itemsError } = await supabase.from("trade_items").insert(
    offer.map((o) => ({
      trade_id: trade.id,
      card_instance_id: o.instanceId,
      direction: o.direction === "mine" ? "from_proposer" : "from_recipient",
      quantity: o.quantity,
    })),
  );

  if (itemsError) {
    // Leave no half-built proposal behind. The trade is still 'proposed' and
    // ours, so this delete is permitted.
    await supabase.from("trades").delete().eq("id", trade.id);
    return fail(`Could not add those cards: ${itemsError.message}`);
  }

  if (counterOf) {
    // Supersede the original. 'countered' is terminal — it moves no cards — and
    // the close policy (migration 12) permits a party to set it.
    const { error: supersedeError } = await supabase
      .from("trades")
      .update({ status: "countered" })
      .eq("id", counterOf);

    if (supersedeError) {
      // Do not leave the counter dangling next to a still-open original.
      await supabase.from("trades").delete().eq("id", trade.id);
      return fail(`Could not replace the original offer: ${supersedeError.message}`);
    }
  }

  revalidate(trade.id);
  return ok(counterOf ? "Counter-offer sent." : "Trade proposed.");
}

/**
 * Accepts a trade, which is what actually moves the cards.
 *
 * Every failure mode is decided in the database — not the recipient, already
 * settled, a card that has since been sold or split — so the errors below are
 * translations rather than checks. The one exception is the terms check, which
 * the database does not know about.
 */
export async function acceptTrade(_prev: SocialState, formData: FormData): Promise<SocialState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const tradeId = String(formData.get("trade_id") ?? "").trim();
  if (!tradeId) return fail("Which trade?");

  const supabase = await createClient();

  if (!(await hasAcceptedTerms(supabase, user.id))) return fail(TOS_ENFORCEMENT_MESSAGE);

  const { error } = await supabase.rpc("accept_trade", { p_trade_id: tradeId });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("no longer owned")) {
      return fail(
        "One of these cards has moved since the trade was proposed. Ask for a fresh offer.",
      );
    }
    if (message.includes("no longer exists")) {
      return fail("A card in this trade has been deleted. Ask for a fresh offer.");
    }
    if (message.includes("expired")) {
      return fail("This offer has expired. Ask them to send it again.");
    }
    if (message.includes("already")) return fail(message);
    if (message.includes("Only the recipient")) {
      return fail("Only the person who received this offer can accept it.");
    }
    return fail(message || "That trade could not be completed.");
  }

  revalidate(tradeId);
  return ok("Trade completed. The cards are now in your collection, unsorted.");
}

/** Declines an incoming offer, or cancels one you sent. */
export async function closeTrade(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const tradeId = String(formData.get("trade_id") ?? "").trim();
  const asProposer = String(formData.get("as_proposer") ?? "") === "true";
  if (!tradeId) return;

  const supabase = await createClient();
  await supabase
    .from("trades")
    .update({ status: asProposer ? "cancelled" : "declined" })
    .eq("id", tradeId);

  revalidate(tradeId);
}
