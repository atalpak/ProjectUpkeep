"use client";

import { useState } from "react";

import { Button, cx, ListRow } from "@/components/ui";
import type { KeepRule } from "@/lib/playtest/keep";
import type { PlaytestCard } from "@/lib/playtest/library";
import {
  formatSignedPercentPoints,
  mergeMissingByCard,
  pluralizeCards,
  rankGapResults,
  selectTopMissing,
  type GapResult,
  type MissingEntry,
} from "@/lib/playtest/present";
import { simulate } from "@/lib/playtest/simulate";

const GAP_HANDS = 3_000;
const GAP_CAP = 12;
/** Fixed rather than random: every candidate (and the baseline) is measured
 *  against the exact same shuffles, so the swing between them is the card's
 *  effect, not sampling noise from two different seeds. */
const GAP_SEED = 20_260_911;

/**
 * "As built" only: for each of the biggest shortfalls, what would keep rate
 * do if that one card's missing copies were added back? Re-simulating per
 * card at the full 10,000 hands would be slow enough to notice for a
 * 12-candidate list, so this runs a smaller, explicitly-labelled sample.
 *
 * A rule edit invalidates whatever `results` is already on screen the same
 * way it does for PlaytestResults — the parent remounts this component with
 * a fresh `key` when mode or rule changes, rather than an effect resetting
 * state on every dependency change.
 */
export function PlaytestGapAnalysis({
  library,
  commander,
  missing,
  rule,
  turns,
}: {
  library: PlaytestCard[];
  commander: PlaytestCard | null;
  missing: MissingEntry[];
  rule: KeepRule;
  turns: number;
}) {
  const [results, setResults] = useState<GapResult[] | null>(null);
  const [measuring, setMeasuring] = useState(false);

  function measure() {
    setMeasuring(true);
    setTimeout(() => {
      const baseline = simulate(
        { library, commander },
        { hands: GAP_HANDS, turns, onThePlay: true, rule, seed: GAP_SEED },
      ).keepRate;

      const candidates = selectTopMissing(mergeMissingByCard(missing), GAP_CAP);
      const measured: GapResult[] = candidates.map(({ card, count }) => {
        const withCard = library.concat(Array.from({ length: count }, () => card));
        const stats = simulate(
          { library: withCard, commander },
          { hands: GAP_HANDS, turns, onThePlay: true, rule, seed: GAP_SEED },
        );
        return { card, missingCount: count, deltaKeepRate: stats.keepRate - baseline };
      });

      setResults(rankGapResults(measured));
      setMeasuring(false);
    }, 0);
  }

  return (
    <section className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">What the missing cards are costing you</h2>
          <p className="text-xs text-ink-muted">
            {GAP_HANDS.toLocaleString()} hands per card, not {(10_000).toLocaleString()} — this
            ranks impact, it is not a precision measurement.
          </p>
        </div>
        <Button type="button" onClick={measure} disabled={measuring}>
          {measuring ? "Measuring…" : "Measure the gap"}
        </Button>
      </div>

      {results ? (
        results.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing missing was worth measuring.</p>
        ) : /* When almost nothing is sleeved, adding any single card back still
               leaves a deck that cannot function, so every swing rounds to zero.
               A list of "0pp" rows looks like a measurement and carries no
               information, so say what happened instead of showing it. */
        results.every((r) => Math.abs(r.deltaKeepRate) < 0.005) ? (
          <p className="text-sm text-ink-muted">
            No single card moves the keep rate measurably — too little of this deck is sleeved
            for a one-card comparison to register. Sleeve more of the list and measure again.
          </p>
        ) : (
          <div>
            {results.map((r) => (
              <ListRow
                key={r.card.key}
                trailing={
                  <span
                    className={cx(
                      "text-sm font-semibold tabular-nums",
                      r.deltaKeepRate >= 0 ? "text-ink" : "text-danger",
                    )}
                  >
                    {formatSignedPercentPoints(r.deltaKeepRate)}
                  </span>
                }
              >
                <span className="text-sm">{r.card.name}</span>
                <span className="ml-2 text-xs text-ink-muted">
                  {pluralizeCards(r.missingCount)} missing
                </span>
              </ListRow>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-ink-muted">
          Ranks the biggest shortfalls (up to {GAP_CAP}) by how much keep rate each would add
          back if you sleeved it.
        </p>
      )}
    </section>
  );
}
