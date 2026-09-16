import { Skeleton } from "@/components/ui";

/**
 * Shown for `/decks` and, absent a more specific loading state, while
 * navigating into `/decks/[id]` too — Next reuses the nearest ancestor
 * `loading.tsx` for a segment that doesn't have its own.
 */
export default function DecksLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/8] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
