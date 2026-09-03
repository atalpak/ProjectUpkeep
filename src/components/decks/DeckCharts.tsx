"use client";

import Image from "next/image";

import { cx } from "@/components/ui";
import type { CurveBucket, DeckStats } from "@/lib/collection/deck-stats";
import type { DeckSection } from "@/lib/collection/deck-view";

/**
 * The deck's shape, at the foot of the page: its mana curve on the left, its
 * colour spread on the right.
 */
export function DeckCharts({ stats }: { stats: DeckStats }) {
  const curveTotal = stats.curve.reduce((sum, b) => sum + b.total, 0);
  if (curveTotal === 0 && stats.colors.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h2 className="text-sm font-semibold">Shape</h2>
      <div className="grid gap-8 md:grid-cols-2">
        <ManaCurve curve={stats.curve} />
        <ColorSpread stats={stats} />
      </div>
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
// Colour spread
// ---------------------------------------------------------------------------

function ColorSpread({ stats }: { stats: DeckStats }) {
  const { colors } = stats;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-ink-muted">Colors</h3>

      {colors.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing on the list yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6 md:grid-cols-3">
            {colors.map((c) => (
              <div key={c.code} className="flex flex-col items-center gap-0.5 text-center">
                <Image
                  src={`https://svgs.scryfall.io/card-symbols/${c.code}.svg`}
                  alt={c.label}
                  width={34}
                  height={34}
                  unoptimized
                  className="shrink-0"
                />
                <span className="text-lg font-semibold tabular-nums">
                  {Math.round(c.cardShare * 100)}%
                </span>
                <span className="text-[11px] tabular-nums text-ink-muted">
                  {c.count} card{c.count === 1 ? "" : "s"}
                </span>
                <span className="text-[11px] tabular-nums text-ink-muted">
                  {Math.round(c.pipShare * 100)}% of pips
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-muted">
            % of cards is by color identity — a multicolor card counts under each of its colors.
          </p>
        </>
      )}
    </div>
  );
}
