import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, Card } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { DeckStateMark } from "@/components/decks/DeckStateMark";
import { entryState } from "@/lib/collection/deck-state";

/**
 * A stand-in for a real deck list, built from the same entryState() logic
 * and DeckStateMark component the actual deck page renders — not a raster
 * screenshot, so it never drifts from what sleeved/available/missing really
 * look like, and it reads correctly in both themes for free. Names are
 * generic on purpose: this is marketing copy, not anyone's real decklist.
 */
const SAMPLE_ROWS = [
  { name: "Sol Ring", note: "sleeved", counts: { wanted: 1, sleeved: 1, available: 0 } },
  {
    name: "Rhystic Study",
    note: "free in Trade Binder",
    counts: { wanted: 1, sleeved: 0, available: 1 },
  },
  { name: "Cyclonic Rift", note: "not owned", counts: { wanted: 1, sleeved: 0, available: 0 } },
] as const;

function DeckPreview() {
  return (
    <Card className="divide-y divide-border p-0">
      {SAMPLE_ROWS.map((row) => (
        <div key={row.name} className="flex items-center gap-3 px-4 py-3">
          <DeckStateMark entry={entryState(row.counts)} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{row.name}</div>
            <div className="text-xs text-ink-muted">{row.note}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

export default async function HomePage() {
  // Signed-in visitors have no use for the marketing page; the dashboard is
  // their home.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <Wordmark size="lg" />

      <div className="grid items-center gap-8 sm:grid-cols-2">
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            A deck is a real place a card lives.
          </h1>
          <p className="text-ink-muted">
            Cards sleeved into one stop counting as available to build with —
            so the rest of your collection, and every friend&rsquo;s trade
            binder, always knows what&rsquo;s actually free.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/signup">
              <Button>Create an account</Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary">Sign in</Button>
            </Link>
          </div>
        </div>

        <DeckPreview />
      </div>

      <p className="text-xs text-ink-muted">
        Card data from Scryfall. No pricing, no marketplace — just your collection.
      </p>
    </main>
  );
}
