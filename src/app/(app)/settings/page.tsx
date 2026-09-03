import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getMyTosStatus } from "@/lib/social/queries";
import { CURRENT_TOS_VERSION, hasAcceptedTos } from "@/lib/social/tos";
import {
  EmailForm,
  PasswordForm,
  UsernameForm,
} from "@/components/settings/AccountForms";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
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

  const supabase = await createClient();
  const [{ data: profile }, tos] = await Promise.all([
    supabase.from("profiles").select("username, created_at").eq("id", user.id).maybeSingle(),
    getMyTosStatus(),
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
        title="Profile"
        description="Your username is the only thing other users can see about you before you are friends."
      >
        <UsernameForm current={profile?.username ?? ""} />
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
              <Link href="/terms" className="text-accent underline">
                trading terms
              </Link>{" "}
              (version {tos?.version}).
            </>
          ) : (
            <>
              You have not accepted the{" "}
              <Link href="/terms" className="text-accent underline">
                trading terms
              </Link>{" "}
              (version {CURRENT_TOS_VERSION}) yet. You will be asked to on the{" "}
              <Link href="/friends" className="text-accent underline">
                friends page
              </Link>{" "}
              before your first trade.
            </>
          )}
        </p>
      </Section>

      <Section
        title="Your data"
        description="Everything here belongs to your account and is visible only to you, except cards in a container you have marked tradable."
      >
        <ul className="space-y-1 text-sm">
          <li>
            <Link href="/collection/import" className="text-accent underline">
              Import cards
            </Link>{" "}
            <span className="text-ink-muted">from a decklist or a CSV export.</span>
          </li>
          <li>
            <Link href="/locations" className="text-accent underline">
              Manage locations
            </Link>{" "}
            <span className="text-ink-muted">
              — deleting one never deletes cards; they become unsorted.
            </span>
          </li>
          <li className="text-ink-muted">
            Account since {new Date(joined).toLocaleDateString()}. To close your account,
            email the address in the terms — there is no self-service delete yet.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </Panel>
  );
}
