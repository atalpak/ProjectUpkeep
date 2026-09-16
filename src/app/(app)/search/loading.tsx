import { Skeleton } from "@/components/ui";

/** Shown while Advanced Search resolves a query. Grid, not rows — image
 *  results are the point of this page. */
export default function SearchLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      <Skeleton className="h-11 w-full max-w-xl rounded-full" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[488/680] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
