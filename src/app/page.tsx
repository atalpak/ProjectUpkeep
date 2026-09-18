import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge, Button, Card, cx } from "@/components/ui";
import { ManaSymbol } from "@/components/ManaCost";
import { Reveal } from "@/components/Reveal";
import { Wordmark } from "@/components/Wordmark";
import { DeckStateMark } from "@/components/decks/DeckStateMark";
import { entryState } from "@/lib/collection/deck-state";
import { MortStage } from "@/components/mort/MortStage";
import { MortLine } from "@/components/mort/MortLine";

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

// ---------------------------------------------------------------------------
// Feature section shell — five of these, one per mana colour, alternating
// sides. The colour is a private joke for anyone who notices (five sections,
// five colours, in no particular order of importance) rather than something
// the copy ever calls out — Magic already means something by each of the
// five, this page doesn't need to explain the reference to earn it.
// ---------------------------------------------------------------------------

type ManaTone = "w" | "u" | "b" | "r" | "g";

const TONE_BORDER: Record<ManaTone, string> = {
  w: "border-w",
  u: "border-u",
  b: "border-b",
  r: "border-r",
  g: "border-g",
};

const TONE_BG: Record<ManaTone, string> = {
  w: "bg-w/10",
  u: "bg-u/10",
  b: "bg-b/10",
  r: "bg-r/10",
  g: "bg-g/10",
};

function FeatureSection({
  tone,
  eyebrow,
  title,
  body,
  visual,
  reverse = false,
}: {
  tone: ManaTone;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  visual: React.ReactNode;
  /** Puts the visual on the left, text on the right — alternated per section
   *  purely for scroll rhythm on a long page, not for meaning. */
  reverse?: boolean;
}) {
  return (
    <Reveal>
      <section className="border-t border-border pt-10">
        <div
          className={cx(
            "grid items-center gap-8 md:grid-cols-2 md:gap-14",
            reverse && "md:[&>*:first-child]:order-2",
          )}
        >
          <div className="space-y-3">
            <span
              className={cx(
                "inline-flex size-8 items-center justify-center rounded-full border-2",
                TONE_BORDER[tone],
                TONE_BG[tone],
              )}
              aria-hidden="true"
            >
              <ManaSymbol code={tone.toUpperCase()} size="sm" />
            </span>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{eyebrow}</p>
            <h2 className="font-brand text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h2>
            <div className="space-y-3 text-sm text-ink-muted sm:text-base">{body}</div>
          </div>

          <div>{visual}</div>
        </div>
      </section>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — know where everything is
// ---------------------------------------------------------------------------

const LOCATE_ANSWERS = [
  { card: "Sol Ring", where: "Binder A", detail: "free to build with", tone: "w" },
  { card: "Lightning Bolt", where: "Atarka, Baby", detail: "sleeved into a deck", tone: "g" },
  { card: "Rhystic Study", where: "3 decks", detail: "all copies spoken for", tone: "r" },
] as const;

const DOT_CLASS: Record<(typeof LOCATE_ANSWERS)[number]["tone"], string> = {
  g: "bg-g",
  w: "bg-w",
  r: "bg-r",
};

function LocateVisual() {
  return (
    <Card className="divide-y divide-border rounded-3xl !p-0 shadow-lg">
      {LOCATE_ANSWERS.map((row) => (
        <div key={row.card} className="space-y-1 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium">{row.card}</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cx("inline-block size-2 rounded-full", DOT_CLASS[row.tone])}
              />
              <Badge>{row.where}</Badge>
            </span>
          </div>
          <div className="text-xs text-ink-muted">{row.detail}</div>
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — sleeve it, and it's spoken for
// ---------------------------------------------------------------------------

function LocationCard({
  name,
  place,
  type,
  note,
  dim,
}: {
  name: string;
  place: string;
  type: string;
  note: string;
  dim?: boolean;
}) {
  return (
    <Card className={cx("space-y-2 rounded-2xl", dim && "opacity-60")}>
      <p className="text-sm font-medium">{name}</p>
      <div className="flex items-center gap-1.5">
        <Badge>{type}</Badge>
        <span className="truncate text-xs text-ink-muted">{place}</span>
      </div>
      <p className="text-xs text-ink-muted">{note}</p>
    </Card>
  );
}

function SleeveVisual() {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="min-w-0 flex-1">
        <LocationCard name="Lightning Bolt" type="Binder" place="Binder A" note="Counts as available" />
      </div>
      <span aria-hidden="true" className="shrink-0 text-xl text-ink-muted">
        →
      </span>
      <div className="min-w-0 flex-1">
        <LocationCard
          name="Lightning Bolt"
          type="Deck"
          place="Atarka, Baby"
          note="No longer available — it's busy"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — trade with people you actually know
// ---------------------------------------------------------------------------

function TradeVisual() {
  return (
    <Card className="space-y-3 rounded-3xl shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Trade with Sam</p>
        <Badge>Accepted</Badge>
      </div>
      <div className="space-y-2 divide-y divide-border rounded-xl border border-border">
        <div className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-ink-muted">You send</span>
          <span className="font-medium">Cyclonic Rift</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-ink-muted">They send</span>
          <span className="font-medium">Rhystic Study</span>
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Ownership moved the moment this was accepted — no listing, no fee, no stranger.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — your friends already have what you're missing
// ---------------------------------------------------------------------------

function WishVisual() {
  return (
    <Card className="space-y-3 rounded-3xl shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">On your wish list</p>
        <Badge>Sol Ring</Badge>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Sam has 2</p>
          <p className="text-xs text-ink-muted">Open for trade, Trade Binder</p>
        </div>
        <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full bg-g" />
      </div>
      <p className="text-xs text-ink-muted">
        Checked against your whole circle&rsquo;s tradable binders, not just whether someone has it.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 6 — know your odds before you shuffle up
// ---------------------------------------------------------------------------

function PlaytestVisual() {
  return (
    <Card className="space-y-4 rounded-3xl shadow-lg">
      <div>
        <p className="text-xs font-medium text-ink-muted">Keep rate, on the play</p>
        <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">82%</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full w-[82%] rounded-full bg-b" aria-hidden="true" />
      </div>
      <p className="text-xs text-ink-muted">
        1,000 simulated opening hands against this exact decklist, not a hypothetical one.
      </p>
    </Card>
  );
}

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
          <h1 className="font-brand text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Collection management that feels like magic.
          </h1>
          <p className="text-base text-ink-muted sm:text-lg">
            Most trackers know <em>what</em> you own. Upkeep knows{" "}
            <strong className="font-medium text-ink">where</strong> it is —
            this binder, that box, sleeved into a deck — and that&rsquo;s the
            difference between a number and an answer.
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

        {/* Mort sits behind the deck preview, `l` scene size — md and up only.
            Below md the detailed L scene is omitted rather than shrunk into an
            xs/s slot (brand doc §26: "do not shrink a detailed L scene into an
            xs slot"). */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-16 hidden md:block"
          >
            <MortStage size="l" reaction="idle" />
          </div>
          <DeckPreview />
          <div className="mt-3 text-center">
            <MortLine>Filed.</MortLine>
          </div>
        </div>
      </section>

      {/* ---- five features, five colours ---- */}
      <div className="mt-16 space-y-16">
        <FeatureSection
          tone="w"
          eyebrow="Find anything"
          title="Know where everything is"
          body={
            <>
              <p>
                Ask, and it answers: in Binder A, or sleeved into a deck, or
                that every copy you own is already spoken for.
              </p>
              <p>
                Put a card on your want list and it goes further — it names
                which of your friends has a spare, and how many.
              </p>
            </>
          }
          visual={<LocateVisual />}
        />

        <FeatureSection
          tone="u"
          eyebrow="One honest rule"
          title="Sleeve it, and it's spoken for"
          body={
            <p>
              A card filed in a deck stops counting as available everywhere
              else in the app — not because Upkeep hides it, but because
              it&rsquo;s true. That one rule is what keeps every other number
              honest.
            </p>
          }
          visual={<SleeveVisual />}
          reverse
        />

        <FeatureSection
          tone="r"
          eyebrow="Trading"
          title="Trade with people you actually know"
          body={
            <p>
              Propose a trade, they accept, and ownership moves — instantly,
              both directions, logged for good. No listings, no fees, no
              strangers. It&rsquo;s the binder across the table, digitized.
            </p>
          }
          visual={<TradeVisual />}
        />

        <FeatureSection
          tone="g"
          eyebrow="Wish list"
          title="Your friends already have what you're missing"
          body={
            <p>
              Put a card on your want list and Upkeep checks your whole
              circle&rsquo;s tradable binders for it — not just whether
              someone has it, but how many, and where.
            </p>
          }
          visual={<WishVisual />}
          reverse
        />

        <FeatureSection
          tone="b"
          eyebrow="Playtest"
          title="Know your odds before you shuffle up"
          body={
            <p>
              Playtest simulates thousands of opening hands and mulligans
              against your actual decklist — not a hypothetical one — so you
              know your real keep rate before you ever draw a card at the
              table.
            </p>
          }
          visual={<PlaytestVisual />}
        />
      </div>

      {/* ---- value, and the one real non-goal ---- */}
      <Reveal>
        <section className="mt-16 grid gap-8 border-t border-border pt-10 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-brand text-xl font-semibold tracking-tight">
              What it&rsquo;s worth, honestly
            </h2>
            <p className="text-sm text-ink-muted">
              Prices come from Scryfall&rsquo;s daily export, TCGplayer-derived,
              and priced per finish — so a foil is never quietly valued as a
              non-foil.
            </p>
            <p className="text-sm text-ink-muted">
              A card with no price shows as{" "}
              <span className="text-ink">unpriced, never zero</span> — and the
              total says how many.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="font-brand text-xl font-semibold tracking-tight">
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
      </Reveal>

      {/* ---- close ---- */}
      <section className="mt-16 border-t border-border pt-10">
        <p className="font-brand text-base">
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
          <Link href="/terms" className="text-accent-text underline">
            Trading terms
          </Link>
          <Link href="/privacy" className="text-accent-text underline">
            Privacy
          </Link>
        </p>
      </section>
    </main>
  );
}
