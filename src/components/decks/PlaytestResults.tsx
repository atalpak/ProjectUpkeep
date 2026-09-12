"use client";

import { useMemo, useState } from "react";

import { BarChart, LinesByTurnChart, type Bar, type LineSeries } from "@/components/decks/PlaytestCharts";
import { Button, EmptyState, Select, Stat } from "@/components/ui";
import type { KeepRule } from "@/lib/playtest/keep";
import type { PlaytestCard } from "@/lib/playtest/library";
import {
  formatPercent,
  hasReliableColorData,
  landThresholdShares,
  notableLandCounts,
  peakIndex,
  uniqueLibraryCardsWithCounts,
} from "@/lib/playtest/present";
import { cardByTurnOdds, copiesByTurnOdds, simulate, type SimulateStats } from "@/lib/playtest/simulate";

const HANDS = 10_000;
const LAND_THRESHOLDS = [3, 4, 5];

/**
 * The aggregate numbers: run the goldfish loop 10,000 times and read what
 * came back. `simulate()` over that many hands takes roughly a second, which
 * is long enough to freeze a tap without the `setTimeout` deferral below —
 * see the brief for why this stays a deferred main-thread call rather than a
 * Web Worker.
 *
 * A rule edit or a mode switch has to invalidate whatever `stats` is already
 * showing — re-running with a changed rule must recompute, never show a
 * stale keep rate under a rule that would no longer produce it. Rather than
 * an effect that clears state on every dependency change, the parent gives
 * this component a `key` derived from mode + rule (see Playtest.tsx), so a
 * change that should invalidate the numbers just remounts it with a blank
 * slate.
 */
export function PlaytestResults({
  library,
  commander,
  rule,
  turns,
}: {
  library: PlaytestCard[];
  commander: PlaytestCard | null;
  rule: KeepRule;
  turns: number;
}) {
  const [stats, setStats] = useState<SimulateStats | null>(null);
  const [running, setRunning] = useState(false);
  const [oddsKey, setOddsKey] = useState("");

  // Commander is singleton, so a plain list of distinct cards would offer
  // ~99 options whose odds are all the same number — see the module header
  // on `uniqueLibraryCardsWithCounts`. Only cards with 2+ copies are worth a
  // picker entry; everything else is covered once by `singleCopyOdds` below.
  const cardsWithCounts = useMemo(
    () => uniqueLibraryCardsWithCounts(library).filter((c) => c.count >= 2),
    [library],
  );
  const selectedCard = cardsWithCounts.find((c) => c.card.key === oddsKey)?.card ?? null;
  const odds = oddsKey ? cardByTurnOdds(library, oddsKey, turns, true) : null;
  const singleCopyOdds = useMemo(
    () => copiesByTurnOdds(1, library.length, turns, true),
    [library.length, turns],
  );

  if (library.length === 0) {
    return <EmptyState title="Nothing to simulate">This mode&apos;s library is empty.</EmptyState>;
  }

  function run() {
    setRunning(true);
    // One tick so the "Running…" state actually paints before the ~1s of
    // synchronous work below.
    setTimeout(() => {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const result = simulate(
        { library, commander },
        { hands: HANDS, turns, onThePlay: true, rule, seed },
      );
      setStats(result);
      setRunning(false);
    }, 0);
  }

  const colorDataReliable = hasReliableColorData(library);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Run the numbers</h2>
        <Button type="button" onClick={run} disabled={running}>
          {running ? "Running…" : `Run ${HANDS.toLocaleString()} hands`}
        </Button>
      </div>

      {stats ? (
        <>
          <div className="rounded-2xl border border-border bg-surface-raised px-6 py-6 text-center">
            <div className="font-display text-6xl font-semibold tabular-nums tracking-tight">
              {formatPercent(stats.keepRate)}
            </div>
            <div className="mt-1 text-sm font-medium text-ink-muted">
              keep rate over {HANDS.toLocaleString()} hands
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Mulligans at all"
              value={formatPercent(1 - stats.mulliganDistribution["0"])}
            />
            <Stat
              label="Colour screw"
              value={colorDataReliable ? formatPercent(stats.colorScrewRate) : "—"}
              hint={
                colorDataReliable
                  ? "Held an uncastable spell purely for colour by the final turn."
                  : "Some lands here have no recorded mana production, so this figure would understate colour problems. A Scryfall re-sync fills that in for any land that does tap for mana."
              }
            />
          </div>

          <OpeningLandChart distribution={stats.openingLandDistribution} rule={rule} />
          <LandsByTurnChart landsByTurn={stats.landsByTurn} turns={turns} />
          {stats.commanderTurn ? (
            <CommanderTurnChart distribution={stats.commanderTurn} />
          ) : null}
        </>
      ) : (
        <p className="text-sm text-ink-muted">Run the simulation to see keep rate and odds.</p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-ink-muted">Card odds</h3>
          {cardsWithCounts.length > 0 ? (
            <Select
              value={oddsKey}
              onChange={(e) => setOddsKey(e.target.value)}
              className="max-w-[16rem] text-xs"
            >
              <option value="">Choose a card…</option>
              {cardsWithCounts.map(({ card, count }) => (
                <option key={card.key} value={card.key}>
                  {card.name} ({count})
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {/* Commander is singleton, so every one-of shares this exact number —
            worth stating once even when the picker above has nothing to
            offer (a deck with no 2+-copy card at all still gets this line). */}
        <p className="text-xs text-ink-muted">
          Any single copy: {formatPercent(singleCopyOdds[0] ?? 0)} by turn 1, rising to{" "}
          {formatPercent(singleCopyOdds[singleCopyOdds.length - 1] ?? 0)} by turn {turns} — the
          odds only depend on copies and deck size, not which card it is.
        </p>

        {odds && selectedCard ? (
          <div>
            <p className="mb-1 text-xs text-ink-muted">
              Exact odds, not simulated — the hypergeometric chance of holding at least one copy
              by each turn, given how many copies are in this library.
            </p>
            <CardOddsChart title={`${selectedCard.name}, by turn`} odds={odds} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The exact per-turn odds for one named card, as a bar per turn rather than
 * the twelve-row list this replaced — same numbers, far less height. Unlike
 * `OpeningLandChart` and `CommanderTurnChart` below, every bar here is
 * "notable": the whole point of this chart is the exact figure for each
 * turn, not a single standout count.
 */
function CardOddsChart({ title, odds }: { title: string; odds: number[] }) {
  const bars: Bar[] = odds.map((chance, i) => ({
    key: String(i + 1),
    axisLabel: String(i + 1),
    value: chance,
    notable: true,
  }));
  return <BarChart title={title} bars={bars} />;
}

function OpeningLandChart({ distribution, rule }: { distribution: number[]; rule: KeepRule }) {
  const notable = new Set(notableLandCounts(distribution, rule));
  const bars: Bar[] = distribution.map((value, count) => ({
    key: String(count),
    axisLabel: String(count),
    value,
    notable: notable.has(count),
  }));
  return <BarChart title="Opening land spread" bars={bars} />;
}

function LandsByTurnChart({ landsByTurn, turns }: { landsByTurn: number[][]; turns: number }) {
  const shares = landThresholdShares(landsByTurn, LAND_THRESHOLDS);
  const series: LineSeries[] = LAND_THRESHOLDS.map((threshold, i) => ({
    key: String(threshold),
    label: `≥${threshold}`,
    values: shares[i],
  }));
  return <LinesByTurnChart title="Lands in play, by turn" turns={turns} series={series} />;
}

function CommanderTurnChart({
  distribution,
}: {
  distribution: NonNullable<SimulateStats["commanderTurn"]>;
}) {
  const peak = peakIndex(distribution.byTurn);
  const bars: Bar[] = distribution.byTurn.map((value, i) => ({
    key: String(i + 1),
    axisLabel: String(i + 1),
    value,
    notable: i === peak,
  }));
  bars.push({ key: "never", axisLabel: "Never", value: distribution.never, notable: true });
  return <BarChart title="First turn the commander is payable" bars={bars} />;
}
