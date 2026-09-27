import { Link } from "react-router-dom";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import BookCover from "./BookCover";
import { CoverChip, Rating, ReadingChip, ShelfChips } from "./BookStatus";

function Dot() {
  return <span aria-hidden className="size-0.5 rounded-full bg-current opacity-60" />;
}

export default function BookCard({ book, shelf, reading }) {
  const draft = book.status === "draft";
  const meta = [
    book.published_year,
    book.chapter_count > 0 && plural(book.chapter_count, "chapter"),
  ].filter(Boolean);
  return (
    <Link
      to={`/${book.slug}`}
      className="group flex flex-col gap-4 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-8 focus-visible:ring-offset-background"
    >
      <div className="relative">
        <BookCover
          book={book}
          className={cn(
            "transition-[transform,box-shadow] duration-300 ease-out-soft group-hover:-translate-y-1.5 group-hover:shadow-book-hover group-focus-visible:-translate-y-1.5",
            draft && "saturate-[0.35]",
          )}
        />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2 transition-transform duration-300 ease-out-soft group-hover:-translate-y-1.5">
          <div className="flex flex-wrap gap-1">
            {draft && (
              <CoverChip label="Draft — visible to editors only" className="text-muted-foreground">
                Draft
              </CoverChip>
            )}
            {reading && <ReadingChip />}
          </div>
          <ShelfChips shelf={shelf} />
        </div>
      </div>
      <div className="grid gap-1 px-0.5">
        <h3 className="line-clamp-2 font-serif text-[17px] font-medium leading-[1.3] tracking-[-0.005em] text-foreground transition-colors duration-150 group-hover:text-primary">
          {book.title}
        </h3>
        {book.author && (
          <p className="truncate text-[13.5px] text-muted-foreground">{book.author}</p>
        )}
        {(meta.length > 0 || shelf?.rating) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground/90">
            {meta.map((m, i) => (
              <span key={m} className="inline-flex items-center gap-2">
                {i > 0 && <Dot />}
                {m}
              </span>
            ))}
            {shelf?.rating && (
              <>
                {meta.length > 0 && <Dot />}
                <Rating value={shelf.rating} className="text-foreground/80" />
              </>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
