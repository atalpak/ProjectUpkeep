import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui";

export default async function HomePage() {
  // Signed-in visitors have no use for the marketing page; the dashboard is
  // their home.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      {/* Signed-out visitors get the toggle too, so the choice is available
          before there is an account to attach it to. */}
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Project Upkeep</h1>
        <p className="mt-3 text-ink-muted">
          A Magic: The Gathering collection tracker that knows{" "}
          <em>where each copy actually is</em> — which binder, which box, which
          deck — so your inventory mirrors reality.
        </p>
      </div>

      <div className="flex gap-3">
        <Link href="/signup">
          <Button>Create an account</Button>
        </Link>
        <Link href="/login">
          <Button variant="secondary">Sign in</Button>
        </Link>
      </div>

      <p className="text-xs text-ink-muted">
        Card data from Scryfall. No pricing, no marketplace — just your collection.
      </p>
    </main>
  );
}
