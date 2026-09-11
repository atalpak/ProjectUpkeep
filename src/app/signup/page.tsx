import { ThemeToggle } from "@/components/ThemeToggle";
import { SignupForm } from "@/components/auth/SignupForm";

/**
 * Never prerendered: `SIGNUP_INVITE_CODE` can change (the owner's plan is to
 * set it in Vercel after launch, to switch open signup over to gated), and a
 * build-time read would freeze whichever state was true when the app was last
 * built rather than reflecting the env var at request time.
 */
export const dynamic = "force-dynamic";

export default function SignupPage() {
  const inviteRequired = Boolean(process.env.SIGNUP_INVITE_CODE?.trim());

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Track where every card actually lives.
      </p>

      <SignupForm inviteRequired={inviteRequired} />
    </main>
  );
}
