"use client";

import { useEffect } from "react";

import { Button, EmptyState } from "@/components/ui";

/**
 * Catches a thrown error anywhere under the signed-in app.
 *
 * Without this, an error thrown while rendering any page here (an aborted
 * fetch, an unexpected null, a Supabase call thrown rather than reporting
 * `.error`) fell through to Next's default full-page error screen — outside
 * the nav shell entirely, and unbranded. `layout.tsx` is a sibling of this
 * file, not a child, so the header and nav stay mounted and reachable while
 * this replaces just the content area.
 *
 * Must be a Client Component — error boundaries only work as one.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Not sent anywhere yet — there is no error-reporting service wired up —
  // but a console trace is strictly better than the silent swallow this
  // boundary would otherwise be.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState title="Something went wrong" icon={false}>
      <p>
        That page hit a snag loading. It might clear itself on a retry, or the
        problem might be on our end — either way, nothing about your
        collection was affected.
      </p>
      <Button type="button" onClick={() => reset()} className="mt-4">
        Try again
      </Button>
    </EmptyState>
  );
}
