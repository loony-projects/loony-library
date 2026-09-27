import { useState } from "react";
import { api } from "@/api";
import { coverPalette } from "@/coverArt";
import { cn } from "@/lib/utils";

// A book-shaped cover: the real image when there is one, otherwise a
// typeset "cloth binding" generated from the book's slug. Sized by its
// container width; all text scales with container query units.
export default function BookCover({ book, className, ...props }) {
  const [failed, setFailed] = useState(false);
  const hasImage = book.cover_image && !failed;
  const palette = coverPalette(book.slug);
  return (
    <div
      className={cn(
        "@container relative aspect-[2/3] w-full overflow-hidden rounded-[3px_7px_7px_3px] shadow-book",
        className,
      )}
      style={hasImage ? undefined : { background: palette.bg, color: palette.ink }}
      {...props}
    >
      {hasImage ? (
        <img
          src={api.coverUrl(book.cover_image)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col px-[10cqw] pb-[10cqw] pt-[13cqw]">
          <span
            className="block h-[1.5cqw] min-h-px w-[16cqw]"
            style={{ background: palette.accent }}
          />
          <span className="mt-[7cqw] line-clamp-5 hyphens-auto font-serif text-[11cqw] font-medium leading-[1.08] tracking-[-0.01em] text-balance [overflow-wrap:break-word]">
            {book.title}
          </span>
          {book.author && (
            <span className="mt-auto line-clamp-2 font-sans text-[5.4cqw] font-medium uppercase leading-snug tracking-[0.14em] opacity-80">
              {book.author}
            </span>
          )}
        </div>
      )}
      {/* Spine crease and a faint sheen so flat colour reads as a bound book. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[8%] bg-[linear-gradient(90deg,rgb(0_0_0/0.22),rgb(255_255_255/0.12)_45%,rgb(0_0_0/0.06)_70%,transparent)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(120deg,rgb(255_255_255/0.1),transparent_45%)] ring-1 ring-inset ring-black/5"
      />
    </div>
  );
}
