import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/support";
import { LegalFooter } from "@/components/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Privacy · Project Upkeep" };

/**
 * The privacy notice.
 *
 * Public for the same reason as `/terms`: it has to be readable before signup,
 * so it lives outside the `(app)` group and its proxy gate and carries no nav
 * shell. Draft wording, owner-reviewed in the PR — kept short and specific
 * because the honest version of this notice is short: one database, RLS, no
 * analytics, no sale of data.
 *
 * `Last updated` is a hand-set string, not `new Date()`: it should change only
 * when the text does, and a live date would silently claim currency the notice
 * has not been reviewed for.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-sm text-ink-muted">Last updated: 11 September 2026</p>
      </div>

      <div className="space-y-4 text-sm leading-relaxed">
        <p>
          Project Upkeep is a personal tool for tracking a Magic: The Gathering collection
          and trading with friends. This explains what it stores and why.
        </p>

        <section className="space-y-2">
          <h2 className="font-semibold">What&rsquo;s collected</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Your email address and a username — to sign you in and let friends find you.
            </li>
            <li>
              Your collection data — cards, quantities, conditions, and the physical
              locations (binders, boxes, decks) you record them in.
            </li>
            <li>Your friends, trade proposals, want list, and trade history.</li>
            <li>Any feedback you submit through the in-app form.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">How it&rsquo;s stored</h2>
          <p>
            All of it lives in a Supabase (PostgreSQL) database with row-level security, so
            you can only read your own data and the tradable binders of people you&rsquo;ve
            added as friends. Passwords are handled by Supabase Auth and are never stored by
            the app directly.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Card data</h2>
          <p>
            Card names, images, prices, and set information come from Scryfall
            (scryfall.com). Prices shown are Scryfall&rsquo;s estimates, for display only —
            the app does not value your collection or facilitate sales.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">What&rsquo;s not done</h2>
          <p>
            No third-party analytics, no advertising, no tracking pixels. Your data is never
            sold or shared with anyone outside the app. Cookies are used only to sign you in
            and keep your session secure.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Deleting your data</h2>
          <p>
            Delete your account any time from{" "}
            <Link href="/settings" className="text-accent underline">
              Settings
            </Link>{" "}
            — it removes your collection, locations, decks, want list, friendships, and
            feedback immediately. One thing survives on purpose: a friend&rsquo;s own copy of a
            trade you completed with them, with your identity removed from it, so closing your
            account cannot erase their record of what they own. Trouble with the form, or a
            question about any of this: email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Contact</h2>
          <p>
            Questions about your data:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>

      <LegalFooter current="privacy" />
    </main>
  );
}
