"use client";

import Image from "next/image";

import { cx } from "@/components/ui";
import type { ColorCount, CurveBucket, DeckStats } from "@/lib/collection/deck-stats";
import type { DeckSection } from "@/lib/collection/deck-view";

/**
 * The deck's shape, at the foot of the page: the mana curve, then a per-colour
 * breakdown beneath it — card share, pip share, and a mini curve for each
 * colour.
 */
export function DeckCharts({ stats }: { stats: DeckStats }) {
  const curveTotal = stats.curve.reduce((sum, b) => sum + b.total, 0);
  if (curveTotal === 0 && stats.colors.length === 0) return null;

  return (
    <section className="space-y-4 border-t border-border pt-4">
      <h2 className="text-sm font-semibold">Shape</h2>
      <ManaCurve curve={stats.curve} />
      <ColorSpread colors={stats.colors} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mana curve
// ---------------------------------------------------------------------------

/** Fixed, non-themed tones — one per card type, so a bar reads at a glance. */
const SECTION_TONE: Record<DeckSection, string> = {
  commander: "bg-amber-400",
  planeswalkers: "bg-pink-400",
  creatures: "bg-emerald-500",
  sorceries: "bg-violet-400",
  instants: "bg-sky-400",
  artifacts: "bg-zinc-400",
  enchantments: "bg-yellow-300",
  battles: "bg-orange-400",
  lands: "bg-lime-600",
  other: "bg-slate-400",
};

const BAR_MAX_PX = 120;

function ManaCurve({ curve }: { curve: CurveBucket[] }) {
  const peak = Math.max(1, ...curve.map((b) => b.total));
  const total = curve.reduce((sum, b) => sum + b.total, 0);

  const legend: DeckSection[] = [];
  for (const b of curve) {
    for (const seg of b.segments) {
      if (!legend.includes(seg.section)) legend.push(seg.section);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted">Mana curve</h3>

      {total === 0 ? (
        <p className="text-xs text-ink-muted">No non-land cards on the list yet.</p>
      ) : (
        <>
          <div className="flex items-end gap-1.5">
            {curve.map((b) => (
              <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-ink-muted">{b.total || ""}</span>
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t bg-surface-muted"
                  style={{
                    height: b.total > 0 ? Math.max(3, (b.total / peak) * BAR_MAX_PX) : 2,
                  }}
                >
                  {b.segments.map((seg) => (
                    <div
                      key={seg.section}
                      className={SECTION_TONE[seg.section]}
                      style={{ flexGrow: seg.count, flexBasis: 0 }}
                      title={`${seg.count} ${seg.label} at ${b.label} mana`}
                    />
                  ))}
                </div>
                <span className="text-[10px] tabular-nums text-ink-muted">{b.label}</span>
              </div>
            ))}
          </div>

          {legend.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
              {legend.map((section) => (
                <span key={section} className="flex items-center gap-1">
                  <span className={cx("size-2.5 rounded-sm", SECTION_TONE[section])} />
                  {sectionLabel(curve, section)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function sectionLabel(curve: CurveBucket[], section: DeckSection): string {
  for (const b of curve) {
    const seg = b.segments.find((s) => s.section === section);
    if (seg) return seg.label;
  }
  return section;
}

// ---------------------------------------------------------------------------
// Colour spread — one column per colour, across the page
// ---------------------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;

function ColorSpread({ colors }: { colors: ColorCount[] }) {
  if (colors.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted">Colors</h3>
      <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
        {colors.map((c) => (
          <ColorCell key={c.code} color={c} />
        ))}
      </div>
      <p className="text-[11px] text-ink-muted">
        Big number is the share of cards with this color in their identity (a multicolor card
        counts under each); the line below is its share of all colored mana symbols.
      </p>
    </div>
  );
}

function ColorCell({ color }: { color: ColorCount }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Image
        src={`https://svgs.scryfall.io/card-symbols/${color.code}.svg`}
        alt={color.label}
        width={40}
        height={40}
        unoptimized
        className="shrink-0"
      />
      <span className="text-2xl font-semibold leading-none tabular-nums">
        {pct(color.cardShare)}
      </span>
      <span className="text-[11px] tabular-nums text-ink-muted">
        {pct(color.pipShare)} of all symbols
      </span>

      <MiniCurve buckets={color.curve} />

      <span className="text-[11px] font-medium">{color.label}</span>
      <span className="text-[11px] tabular-nums text-ink-muted">
        {color.count} card{color.count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

const MINI_MAX_PX = 26;

function MiniCurve({ buckets }: { buckets: number[] }) {
  const peak = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);

  return (
    <div
      className="mt-1 flex h-7 items-end gap-px border-b border-border"
      aria-hidden="true"
      title={
        total > 0
          ? buckets.map((n, i) => `${i === 7 ? "7+" : i}: ${n}`).join("  ")
          : "no non-land cards of this color"
      }
    >
      {buckets.map((n, i) => (
        <div
          key={i}
          className="w-1.5 rounded-t bg-ink-muted/60"
          style={{ height: n > 0 ? Math.max(2, (n / peak) * MINI_MAX_PX) : 0 }}
        />
      ))}
    </div>
  );
}
