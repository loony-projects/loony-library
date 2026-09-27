import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { formatLanguage, plural } from "@/lib/format";
import BookCover from "./BookCover";
import { Rating, ShelfChips } from "./BookStatus";

export default function BookListItem({ book, shelf, reading }) {
  const details = [
    book.publisher,
    book.edition,
    formatLanguage(book.language),
    book.series && `${book.series}${book.volume ? `, vol. ${book.volume}` : ""}`,
  ].filter(Boolean);
  return (
    <Link
      to={`/${book.slug}`}
      className="group -mx-3 flex items-center gap-5 rounded-lg px-3 py-5 outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring sm:gap-6"
    >
      <div className="relative w-16 shrink-0 sm:w-[4.5rem]">
        <BookCover book={book} className="shadow-sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-lg font-medium leading-snug tracking-[-0.005em] transition-colors group-hover:text-primary">
            {book.title}
          </h3>
          {book.status === "draft" && <Badge variant="secondary">Draft</Badge>}
          {reading && <Badge>Reading</Badge>}
        </div>
        {book.author && (
          <p className="mt-0.5 text-sm text-muted-foreground">{book.author}</p>
        )}
        {details.length > 0 && (
          <p className="mt-2 line-clamp-1 text-[13px] text-muted-foreground/90">
            {details.join(" · ")}
          </p>
        )}
        {book.category_name && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Badge variant="outline">{book.category_name}</Badge>
          </div>
        )}
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-2 text-[13px] text-muted-foreground sm:flex">
        <ShelfChips shelf={shelf} />
        {book.published_year && <span className="tabular-nums">{book.published_year}</span>}
        {book.chapter_count > 0 && <span>{plural(book.chapter_count, "chapter")}</span>}
        <Rating value={shelf?.rating} className="text-foreground/80" />
      </div>
      <ChevronRight className="hidden size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block" />
    </Link>
  );
}
