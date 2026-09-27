import { ArrowUpRight } from "lucide-react";
import { plural } from "@/lib/format";
import BookCover from "./BookCover";

// A category shortcut: a fanned trio of its covers above the name and count.
export default function CategoryCard({ name, books, onSelect }) {
  const sample = books.slice(0, 3);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex w-full flex-col overflow-hidden rounded-xl bg-secondary p-5 text-left transition-colors duration-200 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <div className="relative mb-5 flex h-28 items-end justify-center">
        {sample.map((b, i) => {
          const offset = i - (sample.length - 1) / 2;
          return (
            <div
              key={b.id}
              className="absolute bottom-0 w-[4.25rem] transition-transform duration-300 ease-out-soft"
              style={{
                transform: `translateX(${offset * 42}px) rotate(${offset * 6}deg)`,
                zIndex: 3 - Math.abs(offset),
              }}
            >
              <BookCover book={b} className="shadow-md" />
            </div>
          );
        })}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-serif text-lg font-medium">{name}</p>
          <p className="text-[13px] text-muted-foreground">{plural(books.length, "book")}</p>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </button>
  );
}
