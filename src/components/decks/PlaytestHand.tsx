"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";

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
 * Fully self-contained: this used to report whichever card was hovered,
 * focused or tapped up to a reader panel Playtest.tsx rendered beside the
 * hand. That panel is gone — the docked sidebar rendered invisibly below the
 * playtest popup's `<dialog>` top layer, and it fed a card by id, a fetch for
 * data already sitting right here in memory. Reading a card now means
 * enlarging it in place, so there is nothing left to report upward. See
 * HandCard for how.
 */
type Stage = "idle" | "final" | "selecting-bottom";

export function PlaytestHand({ library, rule }: { library: PlaytestCard[]; rule: KeepRule }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [drawnHand, setDrawnHand] = useState<PlaytestCard[] | null>(null);
  const [finalHand, setFinalHand] = useState<PlaytestCard[] | null>(null);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Index into `shown` (below) of whichever card is enlarged right now —
  // hovered, focused, or, on a device with no hover to speak of, tapped. One
  // number rather than a set: only one card is ever held up at a time.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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
    // A different hand entirely — nothing should still be sitting enlarged
    // from the one just discarded.
    setActiveIndex(null);
    setStage("final");
  }

  function mulligan() {
    if (!rngRef.current) return;
    const hand = drawOpeningHand(library, rngRef.current);
    setMulliganCount((n) => n + 1);
    setDrawnHand(hand);
    setFinalHand(null);
    setSelected(new Set());
    setActiveIndex(null);
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
    // The bottomed cards drop out of the array, so every later index shifts
    // — whatever was enlarged before confirming may not even be the same
    // card once `shown` switches over to `finalHand`.
    setActiveIndex(null);
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
        // Generous vertical padding, not just the row's own gap: an enlarged
        // card grows from its own centre, and CSS forces the popup's
        // scrolling container to clip *both* axes the moment overflow-y is
        // anything but visible (a non-`visible` value on one axis makes the
        // other compute to `auto`, never `visible` — never mind that nobody
        // asked for horizontal clipping here). Padding gives the upward half
        // of that growth real, un-clipped box space to bleed into. The
        // downward half needs less help: the mulligan controls, the verdict
        // line and the results below already give it somewhere to spill
        // without reaching the container's own bottom edge.
        <div className="flex flex-wrap gap-3 pt-10 pb-6 sm:pt-16 lg:pt-28">
          {shown.map((card, i) => (
            <HandCard
              key={i}
              card={card}
              index={i}
              isFirst={i === 0}
              isLast={i === shown.length - 1}
              activeIndex={activeIndex}
              onActivate={setActiveIndex}
              selectable={stage === "selecting-bottom"}
              selected={selected.has(i)}
              onToggle={() => toggleSelect(i)}
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

/**
 * Roughly 2.5x at `lg` — ~120px of card becomes ~300px, the point at which a
 * card's own printed rules text starts to be legible on its Scryfall image.
 * That is the whole reason this exists: the reader panel it replaces was the
 * only way to read a hand card, and an enlarge much smaller than this would
 * quietly take that back. Scaled down at narrower breakpoints, off the same
 * `hand` box widths `DeckFace` uses, so the enlarged card still fits a phone
 * screen instead of running off it.
 */
const ENLARGE_SCALE = "scale-[1.6] sm:scale-[1.9] lg:scale-[2.5]";

/** "Pushes the other ones away slightly" — the owner's own words for the
 *  neighbour nudge below, and "slightly" is doing real work: enough to read
 *  as the hand making room, not enough to read as the row rearranging. */
const SHIFT_BEFORE = "-translate-x-2.5 motion-reduce:translate-x-0";
const SHIFT_AFTER = "translate-x-2.5 motion-reduce:translate-x-0";

/** A coarse pointer has no hover at all, so hovering can't be how it reads a
 *  card — see HandCard's own header for what happens on a tap instead. Read
 *  fresh on every interaction rather than cached in state: nothing here
 *  needs to re-render when it changes, only to know the answer at the moment
 *  a pointer event fires. */
function hasNoHover() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function HandCard({
  card,
  index,
  isFirst,
  isLast,
  activeIndex,
  onActivate,
  selectable,
  selected,
  onToggle,
}: {
  card: PlaytestCard;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** Whichever index is enlarged right now, or none. Lifted to the parent
   *  rather than kept per-card: shifting every *other* card away needs to
   *  know where the active one is, not just whether this one is it. */
  activeIndex: number | null;
  /** `setActiveIndex` itself, not a wrapper — passed the raw setter so the
   *  guarded clear below can use its updater form, reading the *current*
   *  active index rather than the one this card's own closure was rendered
   *  with. */
  onActivate: Dispatch<SetStateAction<number | null>>;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const isActive = activeIndex === index;
  const neighbourDirection =
    activeIndex !== null && !isActive ? (index < activeIndex ? "before" : "after") : null;

  const transformClasses = cx(
    // Transform only — scaling or shifting width, margin or anything else
    // would reflow and re-wrap the whole row on every hover, which is
    // exactly the "growing the element for real" option the brief rules out.
    "transition-transform duration-200 ease-out motion-reduce:transition-none",
    isActive && "relative z-20",
    isActive && ENLARGE_SCALE,
    // Edge cards grow inward instead of off the edge: the default centre
    // origin would otherwise push half the growth past the row's own left or
    // right boundary, which the popup's horizontally-clipped scroll
    // container (see the padding comment above) cuts off outright.
    isActive && (isFirst ? "origin-left" : isLast ? "origin-right" : "origin-center"),
    neighbourDirection === "before" && SHIFT_BEFORE,
    neighbourDirection === "after" && SHIFT_AFTER,
  );

  function activate() {
    onActivate(index);
  }

  // Only clears if this card is still the one active — a stray mouseleave
  // or blur firing after focus or hover has already moved to a different
  // card must not deactivate that card instead of this one.
  function deactivate() {
    onActivate((current) => (current === index ? null : current));
  }

  const face = (
    <>
      <DeckFace image={card.imageUri} size="hand" />
      <p className={cx("mt-1 truncate text-center text-[10px] text-ink-muted", CAPTION_WIDTH)}>
        {card.name}
      </p>
    </>
  );

  if (!selectable) {
    // A focusable div, not a button, matching every other hover-only preview
    // target in the app (ProfileTradables, CollectionTable, DeckWorkspace).
    return (
      <div
        onMouseEnter={() => !hasNoHover() && activate()}
        onMouseLeave={() => !hasNoHover() && deactivate()}
        onFocus={activate}
        onBlur={deactivate}
        onClick={() => {
          // A coarse pointer never fired the mouseenter above, so the tap
          // itself has to be what enlarges the card — and has to be able to
          // un-enlarge it too, since there is no "moving the mouse away"
          // equivalent to close with. A fine pointer's click is just the
          // tail end of the hover that already did this; toggling here too
          // would immediately un-enlarge a card the mouse is still sitting
          // on top of.
          if (!hasNoHover()) return;
          onActivate((current) => (current === index ? null : index));
        }}
        tabIndex={0}
        className={cx("shrink-0 cursor-default rounded-lg coarse:min-h-11", transformClasses)}
      >
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      // Unchanged from before the enlarge existed: mid-mulligan, a tap's one
      // job is choosing what goes to the bottom. Layering the coarse-pointer
      // toggle from the branch above on top of that would mean the same tap
      // both re-sorts the row *and* selects a card out from under the
      // player's thumb — hover and focus still enlarge here for anyone with
      // either, just not a tap.
      onClick={onToggle}
      onMouseEnter={() => !hasNoHover() && activate()}
      onMouseLeave={() => !hasNoHover() && deactivate()}
      onFocus={activate}
      onBlur={deactivate}
      aria-pressed={selected}
      aria-label={`${selected ? "Deselect" : "Select"} ${card.name} for the bottom of the library`}
      className={cx("shrink-0 rounded-lg coarse:min-h-11", transformClasses)}
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
