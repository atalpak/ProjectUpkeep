import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge, Button, Card } from "@/components/ui";
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

/**
 * The three steps. Numbered because the order is real: you cannot file cards
 * you have not imported, and a tradable binder is meaningless until something
 * is in it.
 *
 * Every claim here has to stay true of the app, and this page has already
 * shipped a false one — it used to say "no pricing" while prices were being
 * imported and displayed. The named CSV exporters are the ones
 * src/lib/import/parse.ts aliases column headers for; vocabulary.ts normalises
 * the values inside three of those columns, which is a different job.
 */
const STEPS = [
  {
    title: "Bring what you've already got.",
    body: (
      <>
        Paste a decklist, or drop in a CSV from Moxfield, ManaBox, Archidekt or
        Deckbox. You see a preview before anything is saved.
      </>
    ),
  },
  {
    title: "Say where each card actually lives.",
    body: (
      <>
        Binders, boxes, decks — whatever you really use. Sleeve a card into a
        deck and it stops counting as available, because it isn&rsquo;t. That
        one rule is what makes every other number honest.
      </>
    ),
  },
  {
    title: "Open a binder up to your friends.",
    body: (
      <>
        Mark one tradable and they can see what&rsquo;s in it. You can see
        theirs.
      </>
    ),
  },
] as const;

/**
 * The "where is it?" answer. Deliberately three different shapes of answer,
 * because that is the honest range: filed, sleeved into a deck, or owned but
 * entirely spoken for. The third is the one other trackers get wrong.
 */
const LOCATE_ANSWERS = [
  { card: "Sol Ring", where: "Binder A", detail: "free to build with" },
  { card: "Lightning Bolt", where: "Atarka, Baby", detail: "sleeved into a deck" },
  { card: "Rhystic Study", where: "3 decks", detail: "all copies spoken for" },
] as const;

export default async function HomePage() {
  // Signed-in visitors have no use for the marketing page; the dashboard is
  // their home.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <Wordmark size="lg" />

      {/* ---- hero ---- */}
      <section className="mt-8 grid items-center gap-8 sm:grid-cols-2">
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            A deck is a real place a card lives.
          </h1>
          <p className="text-ink-muted">
            Most collection trackers know <em>what</em> you own. Upkeep knows{" "}
            <strong className="font-medium text-ink">where</strong> — which
            binder, which box, which deck. That&rsquo;s what lets it tell you
            what&rsquo;s actually free to build with, what the pile is worth,
            and which of your friends has the card you&rsquo;re missing.
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
      </section>

      {/* ---- how it works ---- */}
      <section className="mt-16">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="space-y-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-accent text-xs font-medium text-accent"
              >
                {i + 1}
              </span>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="text-sm text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- the locate moment ---- */}
      <section className="mt-16 grid items-start gap-8 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Where&rsquo;s my Sol Ring?
          </h2>
          <p className="text-sm text-ink-muted">
            Ask, and it answers: in Binder A, or sleeved into a deck, or that
            every copy you own is already spoken for.
          </p>
          <p className="text-sm text-ink-muted">
            Put a card on your want list and it goes further — it names which of
            your friends has a spare, and how many.
          </p>
        </div>

        <Card className="divide-y divide-border p-0">
          {LOCATE_ANSWERS.map((row) => (
            <div key={row.card} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{row.card}</span>
                <Badge>{row.where}</Badge>
              </div>
              <div className="text-xs text-ink-muted">{row.detail}</div>
            </div>
          ))}
        </Card>
      </section>

      {/* ---- value, and the one real non-goal ---- */}
      <section className="mt-16 grid gap-8 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            What it&rsquo;s worth, honestly
          </h2>
          <p className="text-sm text-ink-muted">
            Prices come from Scryfall&rsquo;s daily export, TCGplayer-derived,
            and priced per finish — so a foil is never quietly valued as a
            non-foil.
          </p>
          <p className="text-sm text-ink-muted">
            A card it can&rsquo;t price is counted as{" "}
            <span className="text-ink">unpriced, never as zero</span>, and your
            collection total tells you how many those were — so the number never
            quietly flatters itself.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            What it isn&rsquo;t
          </h2>
          <p className="text-sm text-ink-muted">
            <strong className="font-medium text-ink">Not a marketplace.</strong>{" "}
            Nothing to list, nothing to sell, no fees, no strangers. When you do
            want to buy a card, it hands you to TCGplayer and gets out of the
            way.
          </p>
        </div>
      </section>

      {/* ---- close ---- */}
      <section className="mt-16 border-t border-border pt-8">
        <p className="font-display text-base">
          I&rsquo;m building this for my own playgroup first, while Project
          Upkeep finds its feet.
        </p>
        <div className="mt-5">
          <Link href="/signup">
            <Button>Create an account</Button>
          </Link>
        </div>
        <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>Card data and prices from Scryfall.</span>
          <Link href="/terms" className="text-accent underline">
            Trading terms
          </Link>
          <Link href="/privacy" className="text-accent underline">
            Privacy
          </Link>
        </p>
      </section>
    </main>
  );
}
