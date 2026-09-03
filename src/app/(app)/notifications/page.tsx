import Link from "next/link";

import { getNotifications } from "@/lib/social/queries";
import {
  notificationHref,
  notificationSentence,
  relativeTime,
} from "@/lib/social/notifications";
import { clearNotifications } from "@/app/(app)/notifications/actions";
import { MarkNotificationsRead } from "@/components/social/MarkNotificationsRead";
import { Button, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Alerts · Project Upkeep" };

/**
 * The notification inbox.
 *
 * Opening it is the acknowledgement — MarkNotificationsRead clears the unread
 * state on view. Each row links to wherever the thing it is about now lives:
 * the friends page for offers still in play, the archive for settled ones.
 */
export default async function NotificationsPage() {
  const notifications = await getNotifications();
  const hasUnread = notifications.some((n) => n.read_at === null);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <MarkNotificationsRead hasUnread={hasUnread} />

      <PageHeader
        title="Alerts"
        subtitle="Offers, and what happened to the ones you sent."
        actions={
          notifications.length > 0 ? (
            <form action={clearNotifications}>
              <Button variant="ghost" type="submit" className="text-xs">
                Clear all
              </Button>
            </form>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="Nothing here yet.">
          When someone sends, accepts, declines or counters a trade, it shows up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {notifications.map((n) => {
            const actor = n.actor?.username ?? "Someone";
            return (
              <li key={n.id}>
                <Link
                  href={notificationHref(n.type)}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      n.read_at === null ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {notificationSentence(n.type, actor)}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {relativeTime(n.created_at)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
