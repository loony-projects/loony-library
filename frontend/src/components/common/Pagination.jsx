import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// 1 … 4 5 [6] 7 8 … 20
function pageItems(page, total) {
  const pages = new Set([1, total, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push(`gap-${p}`);
    items.push(p);
  });
  return items;
}

export default function Pagination({ page, pageCount, onPageChange, className }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-1", className)}>
      <Button
        variant="ghost"
        size="sm"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="pl-2"
      >
        <ChevronLeft />
        Previous
      </Button>
      <div className="hidden items-center gap-1 sm:flex">
        {pageItems(page, pageCount).map((p) =>
          typeof p === "string" ? (
            <span key={p} className="w-8 text-center text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              size="icon-sm"
              variant={p === page ? "outline" : "ghost"}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPageChange(p)}
              className={cn("tabular-nums", p === page && "font-semibold")}
            >
              {p}
            </Button>
          ),
        )}
      </div>
      <span className="px-3 text-sm tabular-nums text-muted-foreground sm:hidden">
        {page} / {pageCount}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page === pageCount}
        onClick={() => onPageChange(page + 1)}
        className="pr-2"
      >
        Next
        <ChevronRight />
      </Button>
    </nav>
  );
}
