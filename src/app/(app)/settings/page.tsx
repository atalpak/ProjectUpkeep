import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { getMyTosStatus, getProfileDetailsById, getPublicDecks } from "@/lib/social/queries";
import { CURRENT_TOS_VERSION, hasAcceptedTos } from "@/lib/social/tos";
import {
  EmailForm,
  PasswordForm,
  UsernameForm,
} from "@/components/settings/AccountForms";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { DeleteAccountForm } from "@/components/settings/DeleteAccountForm";
import { ProfileDetailsForm } from "@/components/settings/ProfileDetailsForm";
import { Card as Panel, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings · Project Upkeep" };

/**
 * Account maintenance.
 *
 * Grouped by what a change affects rather than by which table it touches: who
 * you are to other people, how you sign in, how the app looks, and what you
 * have agreed to. Each section is independent, so nothing here is a single
 * "save" that could half-apply.
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [profile, tos, sharedDecks] = await Promise.all([
    getProfileDetailsById(user.id),
    getMyTosStatus(),
    getPublicDecks(user.id),
  ]);

  const accepted = hasAcceptedTos(tos);
  const joined = profile?.created_at ?? user.created_at;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Your account, and how this app behaves on this device."
      />

      <Section
        id="profile"
        title="Profile"
        description="Your name, avatar, bio and favorites are visible to signed-in members. Shared decks, wishes and trade cards are visible only to friends."
      >
        <UsernameForm current={profile?.username ?? ""} />
        {profile ? (
          <div className="border-t border-border pt-5">
            <ProfileDetailsForm
              profile={profile}
              decks={sharedDecks.map(({ id, name }) => ({ id, name }))}
            />
          </div>
        ) : null}
        {profile?.username ? (
          <p className="text-sm">
            <Link
              href={`/u/${encodeURIComponent(profile.username)}`}
              className="text-accent-text underline"
            >
              View your profile
            </Link>{" "}
            <span className="text-ink-muted">— see the page as yourself or preview it as a friend.</span>
          </p>
        ) : null}
      </Section>

      <Section
        title="Sign-in"
        description="Changing either of these takes effect on your next sign-in."
      >
        <div className="space-y-6">
          <EmailForm current={user.email ?? ""} />
          <div className="border-t border-border pt-6">
            <PasswordForm />
          </div>
        </div>
      </Section>

      <Section
        title="Appearance"
        description="Remembered in this browser, not on your account."
      >
        <AppearanceSettings />
      </Section>

      <Section title="Trading" description="What you have agreed to in order to trade.">
        <p className="text-sm">
          {accepted ? (
            <>
              You accepted the{" "}
              <Link href="/terms" className="text-accent-text underline">
                trading terms
              </Link>{" "}
              (version {tos?.version}).
            </>
          ) : (
            <>
              You have not accepted the{" "}
              <Link href="/terms" className="text-accent-text underline">
                trading terms
              </Link>{" "}
              (version {CURRENT_TOS_VERSION}) yet. You will be asked to on the{" "}
              <Link href="/friends" className="text-accent-text underline">
                friends page
              </Link>{" "}
              before your first trade.
            </>
          )}
        </p>
      </Section>

      <Section
        title="Your data"
        description="Your collection stays private except cards you mark tradable and decklists you share with friends. Friends can also see your wish list."
      >
        <ul className="space-y-1 text-sm">
          <li>
            <Link href="/collection/import" className="text-accent-text underline">
              Import cards
            </Link>{" "}
            <span className="text-ink-muted">from a decklist or a CSV export.</span>
          </li>
          <li>
            <Link href="/locations" className="text-accent-text underline">
              Manage locations
            </Link>{" "}
            <span className="text-ink-muted">
              — deleting one never deletes cards; they become unsorted.
            </span>
          </li>
          <li>
            <a href="/api/collection/export?format=csv" className="text-accent-text underline">
              Export your collection
            </a>{" "}
            <span className="text-ink-muted">as a CSV, or a decklist with ?format=txt.</span>
          </li>
          <li className="text-ink-muted">Account since {new Date(joined).toLocaleDateString()}.</li>
        </ul>
      </Section>

      <Section
        title="Danger zone"
        description="Deleting your account cannot be undone. Export your collection first if you might want it later."
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            This removes your collection, locations, decks, want list, friendships and feedback.
            One thing survives on purpose: a friend&rsquo;s own copy of a trade you completed with
            them stays in their history, with your identity removed from it — closing your
            account cannot erase their record of what they own. See the{" "}
            <Link href="/privacy" className="text-accent-text underline">
              privacy notice
            </Link>{" "}
            for the full picture.
          </p>
          <DeleteAccountForm username={profile?.username ?? ""} />
        </div>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Panel id={id} className="scroll-mt-24 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </Panel>
  );
}
