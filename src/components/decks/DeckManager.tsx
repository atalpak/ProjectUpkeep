"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";

import { createDeck, deleteDeck } from "@/app/(app)/decks/actions";
import { EMPTY_DECK_STATE } from "@/app/(app)/decks/deck-state";
import { artCropUrl } from "@/components/LocationManager";
import { ManaSymbol } from "@/components/ManaCost";
import { Banner, Button, Card as Panel, EmptyState, Input, cx } from "@/components/ui";
import type { DeckSummary } from "@/lib/collection/queries";

/** The deck list, plus the form for starting a new one. */
export function DeckManager({ decks }: { decks: DeckSummary[] }) {
  const [state, action, pending] = useActionState(createDeck, EMPTY_DECK_STATE);

  return (
    <div className="space-y-5">
      <Panel className="space-y-3">
        <h2 className="text-sm font-semibold">Start a deck</h2>
        {/* Keyed on the nonce so a successful create empties the box. */}
        <form key={state.nonce ?? "new"} action={action} className="flex flex-wrap gap-2">
          <Input
            name="name"
            placeholder="Mono-Red Aggro"
            maxLength={80}
            required
            className="max-w-xs"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create deck"}
          </Button>
        </form>

        <Banner kind="error">{state.error}</Banner>
        <Banner kind="success">{state.notice}</Banner>
      </Panel>

      {decks.length === 0 ? (
        <EmptyState title="No decks yet.">
          A deck is a real place a card can be. Create one, then add cards to it from your
          collection — those copies stop counting as available.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One deck, as a compact commander-art tile — the same treatment its own
 * page's banner (`DeckBanner.tsx`) and its Locations-page tile
 * (`LocationManager.tsx`'s `artCropUrl`) already give a deck: the
 * commander's art crop washes the whole tile behind a flat dark scrim, so a
 * grid of decks reads as a shelf of distinct covers rather than a stack of
 * identical grey cards. Four fit a row on desktop (`xl:grid-cols-4` on the
 * parent grid) because there is no room left for anything but the essentials
 * once the tile is that compact: name, commander (or unique-card count),
 * and how much of the list is actually sleeved.
 *
 * Delete stays behind the ⋯ menu: still one click away, never the loudest
 * thing on the tile.
 */
function DeckCard({ deck }: { deck: DeckSummary }) {
  const complete = deck.cardCount > 0 && deck.sleevedCount >= deck.cardCount;
  const pct = deck.cardCount > 0 ? (deck.sleevedCount / deck.cardCount) * 100 : 0;
  const art = artCropUrl(deck.commanderImage);

  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border transition-colors hover:border-accent/50">
      {art ? (
        <>
          <Image
            src={art}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 1280px) 24vw, (min-width: 640px) 33vw, 50vw"
            className="absolute inset-0 object-cover"
          />
          {/* Same flat scrim DeckBanner uses, for the same reason: a crop's
              bright spot lands in a different place on every card, and a
              gradient looks fine on some and leaves the name unreadable on
              others. */}
          <div className="absolute inset-0 bg-black/55" />
        </>
      ) : (
        <div className="absolute inset-0 bg-surface-muted" />
      )}

      {/* Stretched so the whole tile is the target, not just the name. */}
      <Link
        href={`/decks/${deck.id}`}
        className="absolute inset-0 z-0"
        aria-label={deck.name}
      />

      {/* pointer-events-none: this sits above the stretched link (z-10 over
          z-0) to be visible, but as a plain div spanning the whole tile it
          would otherwise catch every click before the link ever saw it —
          nothing here handled the click, so the tile just looked dead.
          DeleteDeckButton opts back in with pointer-events-auto. */}
      <div
        className={cx(
          "pointer-events-none relative z-10 flex h-full flex-col justify-between gap-2 p-3",
          art ? "text-white" : "text-ink",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          {deck.commanderColors.length > 0 ? (
            <div className="flex gap-0.5">
              {deck.commanderColors.map((code) => (
                <ManaSymbol key={code} code={code} size="xs" />
              ))}
            </div>
          ) : (
            <span />
          )}

          {/* Above the stretched link so it stays clickable. */}
          <div className="pointer-events-auto -m-1.5 shrink-0">
            <DeleteDeckButton deckId={deck.id} deckName={deck.name} dark={!!art} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="truncate font-display text-xl font-bold leading-tight tracking-tight">
            {deck.name}
          </p>

          {deck.cardCount > 0 ? (
            <div className="space-y-1">
              <div
                className={cx(
                  "h-1.5 w-full overflow-hidden rounded-full",
                  art ? "bg-white/25" : "bg-surface-muted",
                )}
                role="img"
                aria-label={`${deck.sleevedCount} of ${deck.cardCount} cards sleeved`}
              >
                <span
                  className={cx("block h-full rounded-full", complete ? "bg-[#3fae7a]" : "bg-accent")}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={cx("truncate", art ? "text-white/80" : "text-ink-muted")}>
                  {deck.commanderName ?? `${deck.uniqueCount} unique cards`}
                </span>
                <span
                  className={cx(
                    "shrink-0 tabular-nums",
                    art ? "text-white/80" : "text-ink-muted",
                  )}
                >
                  {complete ? (
                    <span className={cx("font-medium", art ? "text-white" : "text-ink")}>
                      Ready to play
                    </span>
                  ) : (
                    <>
                      <span className={cx("font-medium", art ? "text-white" : "text-ink")}>
                        {deck.sleevedCount} of {deck.cardCount}
                      </span>{" "}
                      sleeved
                    </>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className={cx("truncate text-xs", art ? "text-white/80" : "text-ink-muted")}>
                {deck.commanderName ?? `${deck.uniqueCount} unique cards`}
              </p>
              <p className={cx("text-xs", art ? "text-white/80" : "text-ink-muted")}>
                Nothing on the list yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Delete, behind one confirmation click.
 *
 * Deleting a deck unsorts its cards rather than destroying them, so this is
 * reversible in substance — but a stray click still loses the list and any
 * commander nomination, which is annoying enough to guard.
 *
 * Unarmed it is a quiet ⋯, not a red button. Destructive actions should be
 * reachable, not prominent, and a bordered "Delete" on every row made the
 * loudest thing on the decks page the one action nobody came to perform.
 * Arming it swaps in the full-strength confirmation, where the emphasis
 * belongs.
 */
function DeleteDeckButton({
  deckId,
  deckName,
  dark,
}: {
  deckId: string;
  deckName: string;
  /** Whether this sits over commander-art + scrim, same rule DeckBanner's
   *  own buttons use — a fixed light/dark theme colour would go invisible
   *  or unreadable against the tile's own art background otherwise. */
  dark: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Delete ${deckName}`}
        title={`Delete ${deckName}`}
        className={cx(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors coarse:size-11",
          dark ? "text-white/80 hover:bg-white/15 hover:text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
        )}
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-raised p-1 shadow-xl">
      <form action={deleteDeck}>
        <input type="hidden" name="deck_id" value={deckId} />
        <Button variant="danger" type="submit" className="text-xs">
          Delete
        </Button>
      </form>
      <Button variant="ghost" type="button" onClick={() => setArmed(false)} className="text-xs">
        Cancel
      </Button>
    </div>
  );
}
