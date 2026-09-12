"use client";

import { useEffect, useState } from "react";

import { Playtest } from "@/components/decks/Playtest";
import { Button, Dialog } from "@/components/ui";
import type { DeckListEntry } from "@/lib/collection/queries";

/**
 * The Playtest popup, launched from a deck's own page.
 *
 * `/decks/[id]/test` stays a real route — the deep link, the refresh-safe
 * fallback, the login-bounce-surviving URL, and the proof that `Playtest`
 * itself is shell-agnostic (see that component's own header). This is the
 * second shell: a `Dialog` taking most of the viewport, rendering the exact
 * same `Playtest` with the exact same props. Nothing here is passed to
 * `Playtest` — no `onClose`, no "am I a modal" flag — because it has nothing
 * to say to it; the seam is the whole point.
 *
 * Open state is plain `useState`, not a search param. `/decks/[id]` is
 * `force-dynamic` with seven data calls and `staleTimes.dynamic` at 0, so a
 * URL-driven open would refetch the whole page on every open *and* close —
 * slower than the page it replaces. Accepted cost: the browser back button
 * does not close this.
 */
export function PlaytestLauncher({
  deckName,
  entries,
  commanderCardId,
}: {
  deckName: string;
  entries: DeckListEntry[];
  commanderCardId: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Gates `keepMounted`. `simulate()` runs ~10,000 hands — about a second of
  // main-thread work — so the Playtest tree must not exist on an ordinary
  // deck-page load, but once it has been paid for once it must survive a
  // close, or every reopen re-pays it and every close throws away a drawn
  // hand, mulligan state and result the player may want back. Never reset
  // once true: `keepMounted` only helps if it stays mounted for good.
  const [hasOpened, setHasOpened] = useState(false);

  function launch() {
    setHasOpened(true);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  // Body scroll lock. Nothing else in the app needs one — this is the first
  // dialog that covers enough of the screen for the page scrolling behind it
  // to be visible at all. Scoped here rather than in globals.css so it can
  // never affect a page with no popup on it.
  //
  // Tied to `open`, not `hasOpened`: an effect's cleanup runs both when its
  // dependency changes *and* on unmount, so this one guarantees the lock
  // comes off exactly when the popup closes, however that happens — the X,
  // the reachable close button at the foot of the content, Escape, or the
  // whole page unmounting out from under an open popup because the user
  // navigated away. There is no second `unlock()` call anywhere that could
  // be forgotten; React's own contract is the guarantee, not a matching
  // function this file has to remember to call in every exit path.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Same filled-pill look as the deck banner's Export button, its
          neighbour — the two used to differ (this one was a bare outline)
          which read as an inconsistency rather than a deliberate weighting. */}
      <button
        type="button"
        onClick={launch}
        // text-ink pinned rather than inherited, same reasoning as
        // ExportButtons' trigger: this sits on the deck banner's dark art
        // scrim, which forces white text around it, and a bg-surface fill
        // paired with inherited white would go invisible in light mode.
        className="inline-flex items-center rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted coarse:min-h-11"
      >
        Playtest
      </button>

      <Dialog
        open={open}
        onClose={close}
        keepMounted={hasOpened}
        labelledBy="playtest-popup-title"
        // The backdrop around a dialog this size is a thin frame, not most of
        // the viewport — see dismissOnBackdrop's own comment on Dialog.tsx.
        // Escape still closes it.
        dismissOnBackdrop={false}
        // svh, not dvh: dvh recalculates as iOS Safari's toolbar collapses
        // while scrolling, which would resize an image-heavy scrolling popup
        // out from under a reader's thumb mid-scroll. overflow-hidden on the
        // dialog itself (rather than flex+flex-1 to size the one child below)
        // is what keeps the sticky header's square corners from poking past
        // the dialog's own rounded ones.
        className="m-auto h-[92svh] max-h-[92svh] w-[min(80rem,96vw)] max-w-none overflow-hidden rounded-2xl border border-border"
      >
        <div className="h-full overflow-y-auto overscroll-contain">
          {/* Sticky inside the scroll container, not floating above it — an X
              anchored to the dialog itself scrolls away with the content the
              moment a phone's popup runs longer than one screen. */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
            <h2
              id="playtest-popup-title"
              className="min-w-0 truncate font-display text-lg font-semibold tracking-tight"
            >
              Playtest — {deckName}
            </h2>
            {/* coarse:size-11 for the 44px floor — CardSheet's own close
                button (CardPanel.tsx) is size-9 with no coarse growth and
                sits under it; AppNav's drawer close is the one to match. */}
            <button
              type="button"
              onClick={close}
              aria-label="Close playtest"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink coarse:size-11"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="size-5"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="space-y-5 p-4">
            <Playtest entries={entries} commanderCardId={commanderCardId} />

            {/* A second, reachable close at the end of the content: standing
                at a table with a phone in one hand, the top-right corner of a
                near-fullscreen popup is the hardest place to reach, and
                anyone scrolled this far is done, not about to hover another
                card. */}
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Close playtest
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
