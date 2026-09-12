"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { ManaCost } from "@/components/ManaCost";
import { PlaytestGapAnalysis } from "@/components/decks/PlaytestGapAnalysis";
import { PlaytestHand } from "@/components/decks/PlaytestHand";
import { PlaytestResults } from "@/components/decks/PlaytestResults";
import { cx, EmptyState, Field, Input } from "@/components/ui";
import type { DeckListEntry } from "@/lib/collection/queries";
import { defaultKeepRule, type KeepRule } from "@/lib/playtest/keep";
import { buildLibrary, type PlaytestCard } from "@/lib/playtest/library";
import { clampInt, pluralizeCards } from "@/lib/playtest/present";

type Mode = "designed" | "built";

/**
 * The goldfishing consistency lab. Everything here runs client-side off the
 * one decklist load the server page hands over — no route, no server
 * action, so switching mode or nudging the keep rule is instant and never
 * round-trips.
 *
 * `buildLibrary` runs for *both* modes up front rather than only the active
 * one: the toggle needs both sizes to show "99 cards · 84 sleeved" and to
 * know whether the two are equal (deck fully assembled), regardless of which
 * one the user is currently looking at.
 *
 * Shell-agnostic on purpose: this component takes only `entries` and
 * `commanderCardId` and knows nothing about where it is mounted. Two shells
 * render it today — the standing `/decks/[id]/test` route and the popup
 * launched from the deck page (PlaytestLauncher.tsx) — and a future board
 * playtester at its own route is exactly why this stays that narrow.
 */
export function Playtest({
  entries,
  commanderCardId,
}: {
  entries: DeckListEntry[];
  commanderCardId: string | null;
}) {
  // The card last hovered, focused or tapped in the drawn hand, fed to the
  // reader panel below. Lives here rather than in PlaytestHand because the
  // panel sits beside the hand, not inside it — see CardReader's own header
  // for why this replaced the shared CardPanel preview outright.
  const [activeCard, setActiveCard] = useState<PlaytestCard | null>(null);
  const designed = useMemo(
    () => buildLibrary(entries, { mode: "designed", commanderCardId }),
    [entries, commanderCardId],
  );
  const built = useMemo(
    () => buildLibrary(entries, { mode: "built", commanderCardId }),
    [entries, commanderCardId],
  );

  const designedSize = designed.library.length + (designed.commander ? 1 : 0);
  const builtSize = built.library.length + (built.commander ? 1 : 0);
  const fullyAssembled = designedSize === builtSize;

  const [mode, setMode] = useState<Mode>("designed");
  const active = mode === "built" && !fullyAssembled ? built : designed;

  // A Commander deck plays a bigger library to the same seven-card hand than
  // a 60-card deck does, so both what counts as "enough lands" and how far a
  // game gets played out key off the deck's designed size — see
  // defaultKeepRule's own header. Switching mode changes what got drawn, not
  // what "consistent" means, so this stays fixed regardless of `mode`.
  const turns = designedSize >= 99 ? 12 : 8;
  const [rule, setRule] = useState<KeepRule>(() => defaultKeepRule(designedSize));

  function updateRule(patch: Partial<KeepRule>) {
    setRule((r) => ({ ...r, ...patch }));
  }

  // Which mode is actually driving the library right now (fullyAssembled
  // pins this to "designed" regardless of what the toggle shows), plus the
  // rule's own values — everything a cached simulation result depends on.
  // Used as a `key` below so a mode switch or a rule edit remounts the
  // results/gap components with a blank slate instead of an effect quietly
  // clearing state out from under them (see each component's own header).
  const activeMode = mode === "built" && !fullyAssembled ? "built" : "designed";
  const resultsKey = `${activeMode}-${rule.minLands}-${rule.maxLands}-${rule.requireCastableByTurn}`;

  if (designedSize === 0) {
    return (
      <EmptyState title="Nothing on this list yet">
        Add cards to the deck before playtesting it.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <ModeToggle
        mode={mode}
        onChange={setMode}
        designedSize={designedSize}
        builtSize={builtSize}
        fullyAssembled={fullyAssembled}
      />

      {designed.skipped > 0 ? (
        <p className="text-xs text-ink-muted">
          {pluralizeCards(designed.skipped)} could not be simulated — no card data.
        </p>
      ) : null}

      <KeepRuleEditor rule={rule} onChange={updateRule} />

      {/* The hand and its reader side by side once there is room for both;
          stacked on a phone, reader directly under the hand it reads — the
          nearest sensible spot to where the tap that filled it happened. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-5">
        <PlaytestHand
          key={activeMode}
          library={active.library}
          rule={rule}
          onCardActivate={setActiveCard}
        />
        <CardReader card={activeCard} className="mt-4 lg:sticky lg:top-4 lg:mt-0" />
      </div>

      <PlaytestResults
        key={resultsKey}
        library={active.library}
        commander={active.commander}
        rule={rule}
        turns={turns}
      />

      <p className="text-xs text-ink-muted">
        This goldfishes the deck alone — no opponent, no combat, nothing to interact with. It also
        can&apos;t see ramp, fetch lands, a modal double-faced card played as a land, or card
        selection (draw/dig effects) — anything it can&apos;t reason about is simply not modelled,
        which makes every number above a floor on how consistent the deck really is, never a
        ceiling.
      </p>

      {mode === "built" && !fullyAssembled && active.missing.length > 0 ? (
        <PlaytestGapAnalysis
          key={resultsKey}
          library={active.library}
          commander={active.commander}
          missing={active.missing}
          rule={rule}
          turns={turns}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
  designedSize,
  builtSize,
  fullyAssembled,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  designedSize: number;
  builtSize: number;
  fullyAssembled: boolean;
}) {
  const options: Array<{ value: Mode; label: string }> = [
    { value: "designed", label: "As designed" },
    { value: "built", label: "As built" },
  ];

  return (
    <div className="space-y-1.5">
      <div
        className="inline-flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Playtest mode"
      >
        {options.map((option) => {
          const isActive = fullyAssembled ? option.value === "designed" : mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => !fullyAssembled && onChange(option.value)}
              aria-pressed={isActive}
              disabled={fullyAssembled}
              className={cx(
                "px-3.5 py-2 text-sm font-medium transition-colors coarse:min-h-11",
                isActive ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
                fullyAssembled && "cursor-not-allowed opacity-60",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs tabular-nums text-ink-muted">
        {pluralizeCards(designedSize)} · {builtSize} sleeved
      </p>

      {fullyAssembled ? (
        <p className="text-xs text-ink-muted">
          Every card on the list is sleeved, so &quot;as built&quot; would play identically — the
          toggle stays off until that changes.
        </p>
      ) : mode === "built" ? (
        <p className="text-xs text-ink-muted">
          Shuffling exactly what&apos;s physically in the box — a smaller library, so you&apos;ll
          see more of it each game. Missing cards are not swapped in for basics; they&apos;re just
          not there.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keep rule editor
// ---------------------------------------------------------------------------

function KeepRuleEditor({
  rule,
  onChange,
}: {
  rule: KeepRule;
  onChange: (patch: Partial<KeepRule>) => void;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
      <div>
        <h2 className="text-sm font-semibold">Keep rule</h2>
        <p className="text-xs text-ink-muted">
          Keeping {rule.minLands}–{rule.maxLands} lands with something castable by turn{" "}
          {rule.requireCastableByTurn}.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Min lands">
          <Input
            type="number"
            min={0}
            max={7}
            value={rule.minLands}
            onChange={(e) => onChange({ minLands: clampInt(e.target.valueAsNumber, 0, 7) })}
          />
        </Field>
        <Field label="Max lands">
          <Input
            type="number"
            min={0}
            max={7}
            value={rule.maxLands}
            onChange={(e) => onChange({ maxLands: clampInt(e.target.valueAsNumber, 0, 7) })}
          />
        </Field>
        <Field label="Castable by turn">
          <Input
            type="number"
            min={1}
            max={7}
            value={rule.requireCastableByTurn ?? ""}
            onChange={(e) =>
              onChange({ requireCastableByTurn: clampInt(e.target.valueAsNumber, 1, 7) })
            }
          />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card reader
// ---------------------------------------------------------------------------

/**
 * A large read-out for whichever hand card was last hovered, focused or
 * tapped — the in-popup answer to the collision documented on PlaytestHand:
 * `useCardPreview`'s three presentations (docked sidebar, portalled tooltip,
 * touch sheet) all render below a `<dialog>`'s top layer, so a card hovered
 * inside the playtest popup showed nothing at all. That machinery exists to
 * pick a presentation per pointer/viewport/preference; this panel is always
 * the same element regardless of any of those, so it needs none of it — one
 * `imageUri` and `oracleText`, already sitting in `PlaytestCard`, cover
 * hover, keyboard focus and tap alike.
 *
 * Fed from `PlaytestCard` rather than a fetched `Card`: the fetch this
 * replaces (`/api/cards/{id}` behind three sequential Supabase round trips,
 * `CardPanel.tsx`'s documented slow path) has nothing this panel needs that
 * `buildLibrary` had not already read once, up front, for the whole library.
 *
 * Rendered by `Playtest` itself rather than by either shell, so the route
 * and the popup show it identically — the route's own docked CardPanel
 * sidebar no longer applies to a hand card as a result, which is the
 * intended trade for one code path and no wasted requests.
 */
function CardReader({ card, className }: { card: PlaytestCard | null; className?: string }) {
  if (!card) {
    return (
      <div
        aria-live="polite"
        className={cx(
          "rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted",
          className,
        )}
      >
        Hover, focus or tap a card in your hand to read it here.
      </div>
    );
  }

  return (
    <div aria-live="polite" className={cx("space-y-2", className)}>
      <div className="relative aspect-[488/680] overflow-hidden rounded-xl border border-border bg-surface-muted">
        {card.imageUri ? (
          <Image
            src={card.imageUri}
            alt={card.name}
            fill
            sizes="(min-width: 1024px) 18rem, 90vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-muted">
            No image
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{card.name}</h3>
        {card.manaCost ? <ManaCost cost={card.manaCost} /> : null}
      </div>
      <p className="text-xs text-ink-muted">{card.typeLine}</p>
      {card.oracleText ? (
        <p className="whitespace-pre-line text-xs text-ink-muted">{card.oracleText}</p>
      ) : null}
    </div>
  );
}
