"use client";

import { useRef, useState } from "react";

import { DeckFace } from "@/components/decks/DeckFace";
import { Button, cx, EmptyState } from "@/components/ui";
import { evaluateHand, type KeepRule } from "@/lib/playtest/keep";
import type { PlaytestCard } from "@/lib/playtest/library";
import { describeHandEvaluation, drawOpeningHand } from "@/lib/playtest/present";
import { mulberry32, type RNG } from "@/lib/playtest/rng";

/**
 * Draw a hand, read what the keep rule thinks of it, and mulligan for real —
 * a proper London mulligan where the *user* chooses what goes to the bottom,
 * which is the one thing a spreadsheet or Moxfield's own goldfish tool
 * doesn't offer.
 *
 * `stage` tracks exactly one open question at a time: nothing drawn yet, a
 * settled hand to read, or a freshly-mulliganed seven waiting on the player
 * to choose what to bottom. The bottomed cards are never shown struck
 * through — once confirmed they are just gone, the way they would be at a
 * real table.
 *
 * Every draw rolls its own random seed. There used to be a seed field for
 * recovering a specific hand, but nobody goldfishing at a table types a
 * number back in, and it hid a sharper bug: the box echoed back whatever
 * seed the last draw had used, so pressing the button again without
 * clearing it first silently replayed the same hand rather than a fresh
 * one. `draw` below is the fix — it always picks a new seed, and always
 * resets the mulligan count, any bottom-selection and the previous verdict,
 * so a fresh hand never carries yesterday's state with it.
 *
 * A mode switch changes the whole pool a hand is drawn from — a hand held
 * over from "as designed" could contain a card "as built" doesn't even have a
 * copy of. Rather than reconcile that here, the parent remounts this
 * component with a fresh `key` on mode change (see Playtest.tsx), which
 * resets every piece of state below for free.
 *
 * `onCardActivate` reports whichever card was last hovered, focused or
 * tapped, so `Playtest`'s own reader panel can show it — the shared
 * CardPanel preview (a docked sidebar or a portalled tooltip, depending on
 * viewport) sits below the playtest popup's top layer and so was invisible
 * there, and it fed the card by id, a slow path (an API fetch behind three
 * Supabase round trips) for data already sitting in `PlaytestCard`. This
 * component now knows nothing about any of that — it just reports what was
 * looked at.
 */
type Stage = "idle" | "final" | "selecting-bottom";

export function PlaytestHand({
  library,
  rule,
  onCardActivate,
}: {
  library: PlaytestCard[];
  rule: KeepRule;
  /** Called with whichever hand card was hovered, focused or tapped. */
  onCardActivate: (card: PlaytestCard) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [drawnHand, setDrawnHand] = useState<PlaytestCard[] | null>(null);
  const [finalHand, setFinalHand] = useState<PlaytestCard[] | null>(null);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rngRef = useRef<RNG | null>(null);

  if (library.length === 0) {
    return (
      <EmptyState title="Nothing to draw from">
        This mode&apos;s library is empty — nothing is sleeved for it yet.
      </EmptyState>
    );
  }

  function draw() {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const rng = mulberry32(seed);
    rngRef.current = rng;
    const hand = drawOpeningHand(library, rng);
    setMulliganCount(0);
    setSelected(new Set());
    setDrawnHand(hand);
    setFinalHand(hand);
    setStage("final");
  }

  function mulligan() {
    if (!rngRef.current) return;
    const hand = drawOpeningHand(library, rngRef.current);
    setMulliganCount((n) => n + 1);
    setDrawnHand(hand);
    setFinalHand(null);
    setSelected(new Set());
    setStage("selecting-bottom");
  }

  // London: a fresh seven every time, but one more card goes to the bottom
  // per mulligan already taken — capped at the hand size for the (unlikely,
  // but not crashable) case of mulliganing a library smaller than seven.
  const toBottom = drawnHand ? Math.min(mulliganCount, drawnHand.length) : 0;

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else if (next.size < toBottom) next.add(index);
      return next;
    });
  }

  function confirmBottom() {
    if (!drawnHand) return;
    setFinalHand(drawnHand.filter((_, i) => !selected.has(i)));
    setStage("final");
  }

  const shown = stage === "selecting-bottom" ? drawnHand : finalHand;
  const evaluation = stage === "final" && finalHand ? evaluateHand(finalHand, rule) : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Draw a hand</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={draw}>
            {stage === "idle" ? "Draw a hand" : "Draw a new hand"}
          </Button>
          <Button type="button" variant="secondary" onClick={mulligan} disabled={stage !== "final"}>
            Mulligan
          </Button>
        </div>
      </div>

      {shown ? (
        <div className="flex flex-wrap gap-3">
          {shown.map((card, i) => (
            <HandCard
              key={i}
              card={card}
              selectable={stage === "selecting-bottom"}
              selected={selected.has(i)}
              onToggle={() => toggleSelect(i)}
              onActivate={onCardActivate}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Draw to see an opening hand.</p>
      )}

      {stage === "selecting-bottom" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-muted">
            {/* "Mulligan to six" names the hand you end up with, not how many
                mulligans you have taken — saying "to 1" after one mulligan
                reads as a one-card hand to anyone who plays the game. */}
            Mulligan to {(drawnHand?.length ?? 0) - toBottom}: put {toBottom} card
            {toBottom === 1 ? "" : "s"} on the bottom. Selected {selected.size} of {toBottom}.
          </p>
          <Button type="button" onClick={confirmBottom} disabled={selected.size !== toBottom}>
            Confirm
          </Button>
        </div>
      ) : null}

      {evaluation ? (
        <p className="text-sm">
          <span className={cx("font-semibold", evaluation.keep ? "text-ink" : "text-danger")}>
            {evaluation.keep ? "Keep" : "Mulligan"}
          </span>
          <span className="text-ink-muted"> — {describeHandEvaluation(evaluation, rule)}</span>
        </p>
      ) : null}
    </section>
  );
}

/** Matches `DeckFace`'s `hand` box width at each breakpoint, so the name
 *  caption sits under the card rather than truncating narrower than it. */
const CAPTION_WIDTH = "w-20 sm:w-[6.25rem] lg:w-[7.5rem]";

function HandCard({
  card,
  selectable,
  selected,
  onToggle,
  onActivate,
}: {
  card: PlaytestCard;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onActivate: (card: PlaytestCard) => void;
}) {
  const face = (
    <>
      <DeckFace image={card.imageUri} size="hand" />
      <p className={cx("mt-1 truncate text-center text-[10px] text-ink-muted", CAPTION_WIDTH)}>
        {card.name}
      </p>
    </>
  );

  const activate = () => onActivate(card);

  if (!selectable) {
    // A focusable div, not a button, matching every other hover-only preview
    // target in the app (ProfileTradables, CollectionTable, DeckWorkspace).
    // Hover, focus and tap all call the same handler — the reader panel
    // (Playtest.tsx) is a passive display, not a second answer competing
    // with a tap the way the old sheet presentation was, so there is no
    // "touch only gets one gesture" tension left to resolve here.
    return (
      <div
        onMouseEnter={activate}
        onFocus={activate}
        onClick={activate}
        tabIndex={0}
        className="shrink-0 cursor-default rounded-lg coarse:min-h-11"
      >
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        onToggle();
        activate();
      }}
      onMouseEnter={activate}
      onFocus={activate}
      aria-pressed={selected}
      aria-label={`${selected ? "Deselect" : "Select"} ${card.name} for the bottom of the library`}
      className="shrink-0 rounded-lg coarse:min-h-11"
    >
      <span
        className={cx(
          "relative block rounded-lg transition-shadow",
          selected && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
        )}
      >
        <DeckFace image={card.imageUri} size="hand" />
        {selected ? (
          <span className="absolute inset-x-1 bottom-1 rounded bg-accent px-1 py-0.5 text-center text-[10px] font-medium text-accent-ink">
            Bottom
          </span>
        ) : null}
      </span>
      <p className={cx("mt-1 truncate text-center text-[10px] text-ink-muted", CAPTION_WIDTH)}>
        {card.name}
      </p>
    </button>
  );
}
