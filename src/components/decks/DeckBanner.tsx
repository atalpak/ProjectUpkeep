"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

import { artCropUrl } from "@/components/LocationManager";
import { DeckDetailsEditor } from "@/components/decks/DeckDetails";
import { Price, useShowPrices } from "@/components/PriceToggle";
import { cx } from "@/components/ui";
import type { DeckPrice } from "@/lib/collection/deck-stats";
import type { DeckProgress } from "@/lib/collection/deck-state";
import type { Location } from "@/lib/types";

/**
 * The deck's own page, as a banner rather than a plain header.
 *
 * The commander's art washes the whole thing — the same treatment a deck's
 * tile gets on the Locations page (see `artCropUrl` in LocationManager.tsx) —
 * because on this page the deck is the only thing being looked at, so its
 * identity gets the full width rather than a thumbnail. Everything that used
 * to be a paragraph under a small header (name, commander, tags, progress,
 * dates) lives in one place now; Playtest and Export are passed in as
 * `actions` because they are already wired up as client components on the
 * page that renders this.
 */
export function DeckBanner({
  deck,
  commanderImage,
  commanderName,
  progress,
  price,
  actions,
}: {
  deck: Location;
  /** The commander's full-resolution art, or null with no commander nominated. */
  commanderImage: string | null;
  commanderName: string | null;
  progress: DeckProgress;
  price: DeckPrice;
  actions: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const showPrices = useShowPrices();
  const art = artCropUrl(commanderImage);
  const tags = deck.tags ?? [];

  if (editing) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <DeckDetailsEditor deck={deck} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border">
      {art ? (
        <>
          <Image
            src={art}
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className="absolute inset-0 object-cover"
          />
          {/* A flat scrim, not a gradient: art crops vary wildly in where the
              bright part sits, and a top-to-bottom fade looks fine on some and
              leaves the title unreadable on others. One flat darkening value
              is legible everywhere the art itself is. */}
          <div className="absolute inset-0 bg-black/55" />
        </>
      ) : (
        <div className="absolute inset-0 bg-surface-muted" />
      )}

      <div className={cx("relative z-10 space-y-3 p-5 sm:p-6", art ? "text-white" : "text-ink")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {deck.name}
            </h1>
            <p className={cx("text-sm sm:text-base", art ? "text-white/85" : "text-ink-muted")}>
              {commanderName ?? `${progress.entries} unique cards`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cx(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              art
                ? "border-white/30 text-white/90 hover:bg-white/10"
                : "border-dashed border-border text-ink-muted hover:bg-surface hover:text-ink",
            )}
          >
            {deck.format || tags.length > 0 || deck.notes ? "Edit details" : "Add format, tags, notes"}
          </button>
        </div>

        {deck.format || tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {deck.format ? <Pill dark={!!art}>{deck.format}</Pill> : null}
            {tags.map((tag) => (
              <Pill key={tag} dark={!!art}>
                {tag}
              </Pill>
            ))}
          </div>
        ) : null}

        <p className={cx("text-sm", art ? "text-white/90" : "text-ink")}>
          <span className="font-semibold">
            {progress.sleeved} of {progress.wanted}
          </span>{" "}
          sleeved · {progress.entries} card{progress.entries === 1 ? "" : "s"} on the list
          {progress.missingEntries > 0 ? (
            <> · {progress.missingEntries} not available</>
          ) : null}
          {showPrices ? (
            <>
              {" · "}
              <Price value={price.total} className={art ? "text-white" : "text-ink"} />
              {price.unpriced > 0 ? (
                <span className={art ? "text-white/70" : "text-ink-muted"}>
                  {" "}
                  ({price.unpriced} unpriced)
                </span>
              ) : null}
            </>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-2">{actions}</div>

        <p className={cx("text-xs", art ? "text-white/70" : "text-ink-muted")}>
          Created {formatDate(deck.created_at)} · Updated {formatDate(deck.updated_at)}
        </p>
      </div>
    </div>
  );
}

function Pill({ children, dark }: { children: ReactNode; dark: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        dark ? "border-white/30 text-white/90" : "border-border text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
