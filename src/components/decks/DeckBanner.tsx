"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

import { setDeckPublic } from "@/app/(app)/decks/actions";
import { artCropUrl } from "@/lib/collection/art";
import { DeckDetailsEditor } from "@/components/decks/DeckDetails";
import { Price, useShowPrices } from "@/components/PriceToggle";
import { Button, cx } from "@/components/ui";
import type { DeckPrice } from "@/lib/collection/deck-stats";
import type { DeckProgress } from "@/lib/collection/deck-state";
import type { Location } from "@/lib/types";

/**
 * The switch that shares this deck's list — not its sleeved copies — with
 * accepted friends (migration 35). Modelled on `TradableToggle` in
 * LocationManager.tsx (same `role="switch"` / hidden-input-form shape), but
 * kept out of that file: that toggle is specifically about opening cards for
 * trade, and decks are deliberately excluded from it there for that reason.
 * This is a different switch about a different thing, so it lives with the
 * rest of a deck's own details instead.
 */
function DeckVisibilityToggle({ deck, dark }: { deck: Location; dark: boolean }) {
  const on = deck.is_public;

  return (
    <form action={setDeckPublic}>
      <input type="hidden" name="deck_id" value={deck.id} />
      <input type="hidden" name="is_public" value={on ? "false" : "true"} />
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={on ? `Stop sharing ${deck.name} with friends` : `Share ${deck.name} with friends`}
        title={
          on
            ? "Accepted friends can see this deck's list. Click to make it private again."
            : "Private. Click to let accepted friends see this deck's card list."
        }
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors coarse:min-h-11",
          on
            ? dark
              ? "border-white/60 bg-white/20 text-white"
              : "border-accent bg-accent-soft text-ink"
            : dark
              ? "border-white/30 text-white/80 hover:bg-white/10"
              : "border-border text-ink-muted hover:bg-surface-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "flex h-3.5 w-6 shrink-0 items-center rounded-full px-0.5 transition-colors",
            on ? (dark ? "bg-white" : "bg-accent") : dark ? "bg-white/30" : "bg-surface-muted",
          )}
        >
          <span
            className={cx(
              "size-2.5 rounded-full transition-transform",
              dark && on ? "bg-black/70" : "bg-surface",
              on && "translate-x-2.5",
            )}
          />
        </span>
        {on ? "Shared with friends" : "Private"}
      </button>
    </form>
  );
}

/**
 * The deck's own page, as a banner rather than a plain header.
 *
 * The commander's art washes the whole thing — the same treatment a deck's
 * tile gets on the Locations page (see `artCropUrl` in `@/lib/collection/art`) —
 * because on this page the deck is the only thing being looked at, so its
 * identity gets the full width rather than a thumbnail. Everything that used
 * to be a paragraph under a small header (name, commander, tags, progress,
 * dates) lives in one place now; Playtest and Export are passed in as
 * `actions` because they are already wired up as client components on the
 * page that renders this.
 *
 * Every button the banner offers — the passed-in `actions` and its own "Edit
 * details" — sits together top-right, next to the title. The created/updated
 * dates are the one thing here nobody acts on, so they get tucked bottom-right
 * instead, out of the way of anything tappable.
 */
export function DeckBanner({
  deck,
  commanderImage,
  commanderName,
  progress,
  price,
  gameChangers,
  actions,
}: {
  deck: Location;
  /** The commander's full-resolution art, or null with no commander nominated. */
  commanderImage: string | null;
  commanderName: string | null;
  progress: DeckProgress;
  price: DeckPrice;
  /** Distinct Commander Game Changers on the list, or null pre-sync — see
   *  gameChangerCount in src/lib/collection/deck-stats.ts. */
  gameChangers: number | null;
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

          {/* Everything tappable lives here, together — the passed-in
              actions (Playtest, Export) alongside Edit details, rather than
              split between the top of the banner and its bottom corner. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <DeckVisibilityToggle deck={deck} dark={!!art} />
            {actions}
            <Button type="button" variant="dark" onClick={() => setEditing(true)}>
              {deck.format || tags.length > 0 || deck.notes ? "Edit details" : "Add format, tags, notes"}
            </Button>
          </div>
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
          {gameChangers !== null ? (
            <>
              {" · "}
              {gameChangers} game changer{gameChangers === 1 ? "" : "s"}
            </>
          ) : null}
        </p>

        {/* The dates are the one thing on the banner nobody acts on, so they
            get tucked into the bottom-right corner rather than competing with
            the title or the buttons up top. */}
        <div className="flex justify-end pt-1">
          <p className={cx("text-xs", art ? "text-white/70" : "text-ink-muted")}>
            Created {formatDate(deck.created_at)} · Updated {formatDate(deck.updated_at)}
          </p>
        </div>
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
