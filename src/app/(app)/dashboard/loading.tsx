import { Skeleton } from "@/components/ui";

/**
 * Shown while `getDashboardSummary` and friends are still in flight — every
 * query on this page reads the session cookie, so it can never be static, and
 * without this the nav shell rendered instantly while the content area sat
 * blank for however long those queries took.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-10 w-56" />
        <Skeleton className="mt-3 h-3 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <Skeleton className="mb-3 h-4 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
