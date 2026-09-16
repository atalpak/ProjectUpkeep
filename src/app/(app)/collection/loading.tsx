import { Skeleton } from "@/components/ui";

/**
 * Shown while the collection query (never static — it reads the session and
 * the sort/filter cookies) resolves. Rows, not tiles: the table is the
 * default view, and a skeleton that doesn't match the eventual layout reads
 * as a glitch rather than a loading state.
 */
export default function CollectionLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          >
            <Skeleton className="h-11 w-8 shrink-0 rounded" />
            <Skeleton className="h-4 flex-1 max-w-64" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
