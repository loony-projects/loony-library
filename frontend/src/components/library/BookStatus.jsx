import { Bookmark, BookOpen, Heart, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Small glass chips that sit on a cover's corners to mark shelf state.
export function CoverChip({ className, children, label }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full bg-card/92 px-2 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm [&_svg]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ShelfChips({ shelf }) {
  if (!shelf?.favorite && !shelf?.wishlist) return null;
  return (
    <div className="flex gap-1">
      {shelf.favorite && (
        <CoverChip label="Favorite" className="w-6 justify-center px-0 text-favorite">
          <Heart fill="currentColor" />
        </CoverChip>
      )}
      {shelf.wishlist && (
        <CoverChip label="On your wishlist" className="w-6 justify-center px-0 text-primary">
          <Bookmark fill="currentColor" />
        </CoverChip>
      )}
    </div>
  );
}

export function ReadingChip() {
  return (
    <CoverChip label="Currently reading" className="bg-primary/95 text-primary-foreground">
      <BookOpen />
      Reading
    </CoverChip>
  );
}

export function Rating({ value, className }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", className)} title={`You rated this ${value} of 5`}>
      <Star className="size-3.5 text-star" fill="currentColor" />
      {value}.0
    </span>
  );
}
