import { cn } from "@/lib/utils";
import BookCard from "./BookCard";
import BookListItem from "./BookListItem";

export const gridClass =
  "grid grid-cols-[repeat(auto-fill,minmax(min(9.25rem,100%),1fr))] gap-x-5 gap-y-10 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-x-7 sm:gap-y-12";

export default function BookGrid({ books, view = "grid", shelves = {}, reading = {}, className }) {
  if (view === "list")
    return (
      <ul className={cn("divide-y divide-border", className)}>
        {books.map((b) => (
          <li key={b.id}>
            <BookListItem book={b} shelf={shelves[b.id]} reading={reading[b.id]} />
          </li>
        ))}
      </ul>
    );
  return (
    <ul className={cn(gridClass, className)}>
      {books.map((b) => (
        <li key={b.id}>
          <BookCard book={b} shelf={shelves[b.id]} reading={reading[b.id]} />
        </li>
      ))}
    </ul>
  );
}
