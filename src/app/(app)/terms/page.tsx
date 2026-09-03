import Link from "next/link";

import { CURRENT_TOS_VERSION } from "@/lib/social/tos";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Trading terms · MTGManager" };

/**
 * The trading terms.
 *
 * Plain language on purpose: the charter wants this accepted, not endured, and
 * a wall of boilerplate is how acceptance becomes meaningless. The substance —
 * the operator is not a party to any trade and not liable for one — is in the
 * first two clauses rather than buried.
 *
 * This is a first draft for the solo operator to take to real legal review
 * before launch (charter §8). Bump CURRENT_TOS_VERSION in src/lib/social/tos.ts
 * whenever the wording changes materially; everyone is re-prompted.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Trading terms"
        subtitle={`Version ${CURRENT_TOS_VERSION}. These cover peer-to-peer trades arranged through MTGManager.`}
        backHref="/friends"
        backLabel="Friends"
      />

      <ol className="space-y-4 text-sm leading-relaxed">
        <li>
          <strong className="font-semibold">Trades are between users, not with us.</strong>{" "}
          MTGManager records an agreement you reach with another user and moves the
          matching cards between your collections when the recipient accepts. We are not a
          buyer, a seller, a broker, or an escrow agent for any trade.
        </li>
        <li>
          <strong className="font-semibold">We are not liable for a trade.</strong> Whether
          the physical cards actually change hands, and in what condition, is between you
          and the other user. MTGManager is provided as-is, with no warranty, and we are
          not responsible for loss, non-delivery, misgraded cards, counterfeits, or any
          dispute arising from a trade.
        </li>
        <li>
          <strong className="font-semibold">Only your friends see what you offer.</strong>{" "}
          A card becomes visible to another user only when you have accepted each other as
          friends and you have marked the container it lives in as tradable. Marking a
          container tradable is what makes its cards an offer.
        </li>
        <li>
          <strong className="font-semibold">Accepting a trade is final.</strong> When the
          recipient accepts, the listed cards move between both collections immediately and
          the trade is logged for both parties. There is no automated reversal. Undoing a
          trade means agreeing a new one.
        </li>
        <li>
          <strong className="font-semibold">Trade honestly.</strong> Offer only cards you
          own and physically have, describe their condition accurately, and follow through
          on what you agree. Misrepresenting cards, backing out after a physical exchange,
          or spamming proposals can get your account suspended.
        </li>
        <li>
          <strong className="font-semibold">Card data and images</strong> come from
          Scryfall and Wizards of the Coast. Magic: The Gathering is a trademark of Wizards
          of the Coast. MTGManager is unofficial and not affiliated with or endorsed by
          Wizards of the Coast. Prices shown are a stale third-party estimate, not a quote.
        </li>
        <li>
          <strong className="font-semibold">These terms can change.</strong> If they change
          in a way that matters, you will be asked to accept the new version before your
          next trade.
        </li>
      </ol>

      <p className="text-xs text-ink-muted">
        You record your acceptance from the{" "}
        <Link href="/friends" className="text-accent underline">
          Friends page
        </Link>
        .
      </p>
    </div>
  );
}
