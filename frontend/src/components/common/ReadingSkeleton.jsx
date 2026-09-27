import { Skeleton } from "@/components/ui/skeleton";

export default function ReadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading section">
      <Skeleton className="h-3.5 w-48" />
      <Skeleton className="mt-6 h-10 w-4/5" />
      <Skeleton className="mt-3 h-10 w-2/5" />
      <div className="mt-12 grid gap-3">
        {[100, 96, 99, 70, 0, 100, 94, 98, 88, 45].map((w, i) =>
          w ? <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} /> : <div key={i} className="h-3" />,
        )}
      </div>
    </div>
  );
}
