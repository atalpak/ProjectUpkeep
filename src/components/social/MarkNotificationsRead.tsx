"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";

/**
 * Marks the inbox read as soon as it is looked at.
 *
 * Opening the notifications page is the acknowledgement — there is no separate
 * "mark read" step to remember. Runs once, and only when something is actually
 * unread, then refreshes so the nav badge clears without a reload.
 */
export function MarkNotificationsRead({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !hasUnread) return;
    done.current = true;
    void markAllNotificationsRead().then(() => router.refresh());
  }, [hasUnread, router]);

  return null;
}
