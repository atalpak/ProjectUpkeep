"use client";

import type { ReactNode } from "react";

import { formatPercent } from "@/lib/playtest/present";

/**
 * Chart primitives for the Playtest results, in the same idiom as the mana
 * curve on a deck's own page (DeckCharts.tsx): plain divs sized by inline
 * height, one flat colour, hairline-muted text — not a second visual
 * language and not a charting library. Every chart here carries its own
 * `<details>`-hidden table too, so the numbers survive without colour.
 */

const BAR_MAX_PX = 96;
/** The 2px gap the brief asks for between adjacent bars, so neighbours read
 *  as separate marks rather than one wide block. */
const BAR_GAP = "gap-0.5";

export type Bar = {
  key: string;
  /** Axis label under the bar — a land count, a turn number, "never". */
  axisLabel: string;
  value: number;
  /** Only a notable bar gets a printed number above it — see present.ts's
   *  `notableLandCounts` / `peakIndex` for how callers decide which. */
  notable?: boolean;
};

/**
 * One amber-hued bar per data point. Used for the opening-land-spread chart
 * and the commander-turn chart — both are a single series over a small,
 * fixed set of counts, which is exactly what this renders.
 */
export function BarChart({ title, bars }: { title: string; bars: Bar[] }) {
  const peak = Math.max(0.0001, ...bars.map((b) => b.value));

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted">{title}</h3>
      <div className="overflow-x-auto">
        <div className={`flex items-end ${BAR_GAP}`} style={{ minWidth: Math.max(bars.length * 28, 160) }}>
          {bars.map((bar) => (
            <div key={bar.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-ink">
                {bar.notable ? formatPercent(bar.value) : " "}
              </span>
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: bar.value > 0 ? Math.max(3, (bar.value / peak) * BAR_MAX_PX) : 2 }}
              />
              <span className="text-[10px] tabular-nums text-ink-muted">{bar.axisLabel}</span>
            </div>
          ))}
        </div>
      </div>
      <ChartData>
        <table className="w-full text-left text-[11px] text-ink">
          <thead className="text-ink-muted">
            <tr>
              <th className="pr-3 font-medium">{title}</th>
              <th className="font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key} className="border-t border-border">
                <td className="pr-3 py-0.5">{bar.axisLabel}</td>
                <td className="py-0.5 tabular-nums">{formatPercent(bar.value, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartData>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lands by turn — up to four series, no legend, each line labelled at its end
// ---------------------------------------------------------------------------

export type LineSeries = {
  key: string;
  /** The end-of-line label standing in for a legend entry — "≥3", say. */
  label: string;
  /** Share of games (0..1), one entry per turn. */
  values: number[];
};

const LINE_HEIGHT_PX = 112;
/** Differentiated by opacity and dash rather than hue, since colour alone
 *  never carries the series here — the end labels do the identifying. */
const LINE_STYLES = [
  { opacity: 1, dash: undefined },
  { opacity: 0.75, dash: "5 3" },
  { opacity: 0.5, dash: "1.5 3" },
  { opacity: 0.35, dash: "0.5 4" },
] as const;

/**
 * Share of games with at least N lands in play, one line per threshold, over
 * the turns simulated. One shared y-axis (0–100% of games), and the x-axis is
 * turn number — never a second scale bolted on for a different unit.
 */
export function LinesByTurnChart({
  title,
  turns,
  series,
}: {
  title: string;
  turns: number;
  series: LineSeries[];
}) {
  const lastIndex = Math.max(0, turns - 1);
  const xFor = (turnIndex: number) => (lastIndex === 0 ? 0 : (turnIndex / lastIndex) * 100);
  const yFor = (share: number) => 100 - share * 100;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted">{title}</h3>
      <div className="flex gap-1">
        {/* The one shared y-axis the module header promises: ticks at 0/50/100%
            of games, muted text and a muted gridline rather than a second
            scale or a series colour bleeding into the chrome. */}
        <div
          className="flex w-8 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-ink-muted"
          style={{ height: LINE_HEIGHT_PX }}
          aria-hidden="true"
        >
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>

        <div className="relative flex-1 border-b border-border" style={{ height: LINE_HEIGHT_PX }}>
          {/* Gridlines at the same two upper ticks — the 0% tick is the
              container's own border-b. `bg-border`, never a line's own
              colour, so these read as structure rather than another series. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {series.map((line, i) => {
              const style = LINE_STYLES[i % LINE_STYLES.length];
              const points = line.values.map((v, idx) => `${xFor(idx)},${yFor(v)}`).join(" ");
              return (
                <polyline
                  key={line.key}
                  points={points}
                  fill="none"
                  stroke="var(--ink)"
                  strokeOpacity={style.opacity}
                  strokeDasharray={style.dash}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        </div>

        <div className="relative w-10 shrink-0" style={{ height: LINE_HEIGHT_PX }}>
          {series.map((line) => {
            const lastValue = line.values[line.values.length - 1] ?? 0;
            return (
              <span
                key={line.key}
                className="absolute left-0 -translate-y-1/2 text-[10px] font-medium text-ink"
                style={{ top: `${yFor(lastValue)}%` }}
              >
                {line.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* pl-9 lines this up under the plot area, past the y-axis column
          (w-8) and the gap (gap-1) beside it. */}
      <div className="flex justify-between pl-9 text-[10px] tabular-nums text-ink-muted">
        <span>Turn 1</span>
        <span>Turn {turns}</span>
      </div>

      <ChartData>
        <table className="w-full text-left text-[11px] text-ink">
          <thead className="text-ink-muted">
            <tr>
              <th className="pr-3 font-medium">Turn</th>
              {series.map((line) => (
                <th key={line.key} className="pr-3 font-medium">
                  {line.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: turns }, (_, turnIndex) => (
              <tr key={turnIndex} className="border-t border-border">
                <td className="pr-3 py-0.5 tabular-nums">{turnIndex + 1}</td>
                {series.map((line) => (
                  <td key={line.key} className="pr-3 py-0.5 tabular-nums">
                    {formatPercent(line.values[turnIndex] ?? 0, 1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ChartData>
    </div>
  );
}

/** The text-equivalent every chart needs, folded away by default so it does
 *  not compete with the bars/lines for attention. */
function ChartData({ children }: { children: ReactNode }) {
  return (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer select-none coarse:min-h-11 coarse:flex coarse:items-center">
        Show the numbers
      </summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}
