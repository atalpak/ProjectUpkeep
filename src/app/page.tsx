import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge, Button, Card, cx } from "@/components/ui";
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

/**
 * The real preview, given room to act like the object it represents rather
 * than a bordered box among other bordered boxes: one hairline-divided panel
 * of real rows, with a second panel offset behind it standing in for the
 * rest of the stack a deck actually is. That second panel is the only purely
 * decorative addition — the rows themselves are unchanged.
 */
function DeckPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div
        aria-hidden="true"
        className="absolute inset-x-4 top-3 -bottom-3 -z-10 rotate-2 rounded-3xl border border-border bg-surface-muted"
      />
      {/* `!p-0`, not `p-0`: Tailwind sorts same-property utilities by scale
          rather than by source order, so an unmarked `p-0` here loses the
          cascade to Card's own `p-4` and the padding silently stays 1rem —
          confirmed by compiling this page's actual class list, not assumed. */}
      <Card className="relative divide-y divide-border rounded-3xl !p-0 shadow-lg">
        {SAMPLE_ROWS.map((row) => (
          <div key={row.name} className="flex items-center gap-3 px-5 py-4">
            <DeckStateMark entry={entryState(row.counts)} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{row.name}</div>
              <div className="text-xs text-ink-muted">{row.note}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
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
 * Which of the five colours marks each step. There is no card-colour meaning
 * here — these three have nothing to do with mana — just a small progression
 * instead of three identical dots: green for "start with what you already
 * have," blue for "get organised," white for "open up to others." A visual
 * choice only, which is why it lives beside STEPS rather than inside it.
 */
const STEP_TONES = ["g", "u", "w"] as const;

const TONE_MARKER_CLASS: Record<(typeof STEP_TONES)[number], string> = {
  g: "border-g bg-g/10",
  u: "border-u bg-u/10",
  w: "border-w bg-w/10",
};

/**
 * The "where is it?" answer. Deliberately three different shapes of answer,
 * because that is the honest range: filed, sleeved into a deck, or owned but
 * entirely spoken for. The third is the one other trackers get wrong.
 *
 * `tone` echoes the have/reachable/absent vocabulary DeckStateMark already
 * teaches elsewhere in the app — sleeved reads as "have" (green), free to
 * build with reads as "reachable" (gold), spoken-for reads as "absent" (red)
 * — drawn from the WUBRG tokens rather than DeckStateMark's own fixed hexes,
 * since this is marketing chrome sitting next to that component, not it.
 */
const LOCATE_ANSWERS = [
  { card: "Sol Ring", where: "Binder A", detail: "free to build with", tone: "w" },
  { card: "Lightning Bolt", where: "Atarka, Baby", detail: "sleeved into a deck", tone: "g" },
  { card: "Rhystic Study", where: "3 decks", detail: "all copies spoken for", tone: "r" },
] as const;

const TONE_DOT_CLASS: Record<(typeof LOCATE_ANSWERS)[number]["tone"], string> = {
  g: "bg-g",
  w: "bg-w",
  r: "bg-r",
};

export default async function HomePage() {
  // Signed-in visitors have no use for the marketing page; the dashboard is
  // their home.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <Wordmark size="lg" />

      {/* ---- hero ---- */}
      <section className="mt-10 grid items-center gap-10 md:grid-cols-[1.15fr_1fr] md:gap-14">
        <div className="space-y-5">
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            A deck is a real place a card lives.
          </h1>
          <p className="text-base text-ink-muted sm:text-lg">
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
      <section className="mt-16 border-t border-border pt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-6 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="space-y-2">
              <span
                aria-hidden="true"
                className={cx(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold text-ink",
                  TONE_MARKER_CLASS[STEP_TONES[i]],
                )}
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
      <section className="mt-16 border-t border-border pt-10">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Where&rsquo;s my Sol Ring?
            </h2>
            <p className="text-sm text-ink-muted">
              Ask, and it answers: in Binder A, or sleeved into a deck, or that
              every copy you own is already spoken for.
            </p>
            <p className="text-sm text-ink-muted">
              Put a card on your want list and it goes further — it names which
              of your friends has a spare, and how many.
            </p>
          </div>

          {/* `!p-0` for the same reason as DeckPreview's Card above — Card's
              own `p-4` otherwise wins the cascade over a plain `p-0`. */}
          <Card className="divide-y divide-border rounded-3xl !p-0 shadow-lg">
            {LOCATE_ANSWERS.map((row) => (
              <div key={row.card} className="space-y-1 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{row.card}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cx("inline-block size-2 rounded-full", TONE_DOT_CLASS[row.tone])}
                    />
                    <Badge>{row.where}</Badge>
                  </span>
                </div>
                <div className="text-xs text-ink-muted">{row.detail}</div>
              </div>
            ))}
          </Card>
        </div>
      </section>

      {/* ---- value, and the one real non-goal ---- */}
      <section className="mt-16 grid gap-8 border-t border-border pt-10 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-xl font-semibold tracking-tight">
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
          <h2 className="font-display text-xl font-semibold tracking-tight">
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
      <section className="mt-16 border-t border-border pt-10">
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
