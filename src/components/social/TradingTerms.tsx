"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptTos } from "@/app/(app)/friends/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { CURRENT_TOS_VERSION } from "@/lib/social/tos";
import { Banner, Button, Card as Panel } from "@/components/ui";

/**
 * The trading-terms gate.
 *
 * Shown in place of the trade sections until the user has accepted the current
 * terms. The substance is on the panel, not hidden behind the link: someone
 * should be able to see what they are agreeing to without leaving the page.
 *
 * This is a courtesy, not the enforcement — proposeTrade and acceptTrade check
 * acceptance server-side regardless of what this renders.
 */
export function TradingTerms({ accepted }: { accepted: boolean }) {
  const [state, accept, pending] = useActionState(acceptTos, EMPTY_SOCIAL_STATE);

  if (accepted) {
    return (
      <p className="text-xs text-ink-muted">
        You have accepted the{" "}
        <Link href="/terms" className="text-accent underline">
          trading terms
        </Link>
        .
      </p>
    );
  }

  return (
    <Panel className="space-y-3 border-accent/40">
      <div>
        <h2 className="text-sm font-semibold">Before you trade</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Trading is between you and the other user. Accept these terms once to start.
        </p>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>A trade is an agreement with another user. MTGManager is not a party to it.</li>
        <li>
          We are not liable for a trade — delivery, condition, and disputes are between the
          two of you. The app is provided as-is.
        </li>
        <li>
          Accepting a trade moves the cards between both collections immediately, and there
          is no automated reversal.
        </li>
      </ul>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>

      <div className="flex flex-wrap items-center gap-3">
        <form action={accept}>
          <input type="hidden" name="version" value={CURRENT_TOS_VERSION} />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "I agree to the trading terms"}
          </Button>
        </form>
        <Link href="/terms" className="text-xs text-accent underline">
          Read the full terms
        </Link>
      </div>
    </Panel>
  );
}
