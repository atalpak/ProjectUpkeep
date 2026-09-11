"use client";

import { usePathname } from "next/navigation";
import { useActionState, useState } from "react";

import { sendFeedback } from "@/app/(app)/feedback-actions";
import { Banner, Button, Dialog, Field, Textarea, cx } from "@/components/ui";
import { EMPTY_FEEDBACK_STATE, MAX_BODY_LENGTH } from "@/lib/feedback/validate";

/**
 * "Send feedback" — a trigger in the header cluster and a modal behind it.
 *
 * `Dialog` portals to <body> by default (its own note explains why: nearly
 * every signed-in page under (app) is itself one big <form>, and a <form>
 * nested in a <form> is invalid HTML the parser silently drops, taking the
 * server action with it).
 *
 * `keepMounted` because the dialog's own state has to survive a close: a
 * successful send swaps the form for a thank-you, and reopening after
 * dismissing that should not show it again. There is no toast system in this
 * app and one call site does not justify building one.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [state, action, pending] = useActionState(
    sendFeedback,
    EMPTY_FEEDBACK_STATE,
  );

  // The nonce of the last success the reader has already seen and dismissed, so
  // reopening the dialog starts on a blank form rather than the thank-you.
  const [seenNonce, setSeenNonce] = useState<string>();
  const justSent =
    Boolean(state.nonce) && !state.error && state.nonce !== seenNonce;

  // An error carries no nonce to diff against, so a plain flag stands in for
  // the same "already seen" idea: raised when the dialog opens to hide a banner
  // left over from an earlier failed submit, lowered the moment a new submit
  // starts. Without it a stale <Banner role="alert"> renders over a blank form
  // the next time the dialog opens.
  //
  // Lowering it as the submit fires opens a second gap, though: on a resubmit
  // `state.error` still holds the previous failure until the new action result
  // resolves, so the old banner would flash under the "Sending…" button. The
  // render predicate folds in `pending` to cover that window.
  const [errorStale, setErrorStale] = useState(false);

  function openDialog() {
    setErrorStale(true);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    // Catch up so the next open shows the form again.
    if (state.nonce) setSeenNonce(state.nonce);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="Send feedback"
        aria-haspopup="dialog"
        // Bare <button>, so the 44px touch floor is set here rather than
        // inherited from Button's `coarse:min-h-11`.
        className={cx(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border",
          "text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink coarse:size-11",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 20l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
        </svg>
      </button>

      <Dialog
        open={open}
        onClose={close}
        keepMounted
        labelledBy="feedback-heading"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border"
      >
        <div className="space-y-4 p-4">
          <div>
            <h2 id="feedback-heading" className="text-sm font-semibold">
              Send feedback
            </h2>
            {!justSent && (
              <p className="mt-1 text-xs text-ink-muted">
                Bugs, confusion, something you wish it did — all useful.
              </p>
            )}
          </div>

          {justSent ? (
            <>
              <Banner kind="success">{state.notice}</Banner>
              <div className="flex justify-end">
                <Button type="button" onClick={close}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <form
              action={(formData) => {
                setErrorStale(false);
                action(formData);
              }}
              className="space-y-4"
            >
              <Field label="Your message">
                <Textarea
                  name="body"
                  rows={5}
                  maxLength={MAX_BODY_LENGTH}
                  required
                  autoFocus
                  placeholder="What happened, or what you were trying to do…"
                />
              </Field>

              {/* The route the reader is on, for triage context. Hidden:
                  it is context, not something to edit. */}
              <input type="hidden" name="page" value={pathname} />

              <Banner kind="error">
                {errorStale || pending ? null : state.error}
              </Banner>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Sending…" : "Send"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Dialog>
    </>
  );
}
