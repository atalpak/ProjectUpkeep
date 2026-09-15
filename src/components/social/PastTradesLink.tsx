"use client";

import { useState } from "react";

import { Dialog } from "@/components/Dialog";
import { TradeList } from "@/components/social/TradeList";
import type { TradeDetail } from "@/lib/social/types";

/**
 * "View past trades" — a small link beside the Activity heading rather than
 * its own section, since settled trades are history, not something to check
 * on every visit the way the feed and an outstanding offer are. Opens the
 * same `TradeList` the sidebar used to render inline, in a popup instead.
 *
 * `defaultOpen` exists for one case: a trade notification's `?trade=` link
 * pointing at an offer that has since settled — without it, the highlight
 * that link exists for would be sealed behind a click.
 */
export function PastTradesLink({
  trades,
  userId,
  highlightId,
  defaultOpen = false,
}: {
  trades: TradeDetail[];
  userId: string;
  highlightId?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (trades.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-xs text-ink-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
      >
        View past trades ({trades.length})
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="Past trades"
        className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl sm:mx-auto sm:my-auto sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="max-h-[85dvh] overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Past trades</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
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
          <TradeList trades={trades} userId={userId} highlightId={highlightId} />
        </div>
      </Dialog>
    </>
  );
}
