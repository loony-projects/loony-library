import { Skeleton } from "@/components/ui/skeleton";
import { gridClass } from "./BookGrid";

export function BookGridSkeleton({ count = 10, view = "grid" }) {
  if (view === "list")
    return (
      <div className="divide-y" aria-busy="true" aria-label="Loading books">
        {Array.from({ length: Math.min(count, 6) }, (_, i) => (
          <div key={i} className="flex items-center gap-6 py-5">
            <Skeleton className="aspect-[2/3] w-16 shrink-0 rounded-[3px_7px_7px_3px] sm:w-[4.5rem]" />
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <div className={gridClass} aria-busy="true" aria-label="Loading books">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-4" style={{ animationDelay: `${i * 60}ms` }}>
          <Skeleton className="aspect-[2/3] w-full rounded-[3px_7px_7px_3px]" />
          <div className="space-y-2 px-0.5">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
