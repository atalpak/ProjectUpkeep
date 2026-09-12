"use client";

import { useRef, useState } from "react";

import { DeckFace } from "@/components/decks/DeckFace";
import { Button, cx, EmptyState, Field, Input } from "@/components/ui";
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
 * A mode switch changes the whole pool a hand is drawn from — a hand held
 * over from "as designed" could contain a card "as built" doesn't even have a
 * copy of. Rather than reconcile that here, the parent remounts this
 * component with a fresh `key` on mode change (see Playtest.tsx), which
 * resets every piece of state below for free.
 */
type Stage = "idle" | "final" | "selecting-bottom";

export function PlaytestHand({ library, rule }: { library: PlaytestCard[]; rule: KeepRule }) {
  const [seedText, setSeedText] = useState("");
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
    const seed = seedText.trim() ? Number(seedText) : Math.floor(Math.random() * 2 ** 31);
    const rng = mulberry32(seed);
    rngRef.current = rng;
    const hand = drawOpeningHand(library, rng);
    setSeedText(String(seed));
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
      <h2 className="text-sm font-semibold">Draw a hand</h2>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Seed" hint="Type one back in and draw to recover that exact hand.">
          <Input
            inputMode="numeric"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="random"
            className="w-32"
          />
        </Field>
        <Button type="button" onClick={draw}>
          {stage === "idle" ? "Draw" : "Draw a new hand"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={mulligan}
          disabled={stage !== "final"}
        >
          Mulligan
        </Button>
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

function HandCard({
  card,
  selectable,
  selected,
  onToggle,
}: {
  card: PlaytestCard;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const face = (
    <>
      <DeckFace image={card.imageUri} size="hand" />
      <p className="mt-1 w-20 truncate text-center text-[10px] text-ink-muted">{card.name}</p>
    </>
  );

  if (!selectable) {
    return <div className="shrink-0">{face}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
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
      <p className="mt-1 w-20 truncate text-center text-[10px] text-ink-muted">{card.name}</p>
    </button>
  );
}
