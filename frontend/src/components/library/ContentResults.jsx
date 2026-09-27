import { useState } from "react";
import { ArrowRight, TextSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HighlightText from "./HighlightText";

const INITIAL = 6;

// Passages inside books that match the library search.
export default function ContentResults({ query, results, loading }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? results : results.slice(0, INITIAL);
  return (
    <section aria-labelledby="content-results" className="mt-16 border-t pt-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h2 id="content-results" className="font-serif text-2xl font-medium tracking-tight">
            Found inside the books
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Searching passages…"
              : results.length
                ? `${results.length} passage${results.length === 1 ? "" : "s"} mention “${query.trim()}”`
                : `No passages mention “${query.trim()}”.`}
          </p>
        </div>
      </div>
      {results.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <li key={r.section_id}>
              <Link
                to={`/${r.book_slug}/sections/${r.section_id}`}
                className="group flex h-full flex-col rounded-lg border bg-card p-5 transition-[border-color,box-shadow] duration-200 outline-none hover:border-input hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <TextSearch className="size-3.5" />
                  {r.book_title}
                </span>
                <span className="mt-1.5 font-serif text-[17px] font-medium leading-snug group-hover:text-primary">
                  {r.title}
                </span>
                {r.snippet && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    <HighlightText text={r.snippet} query={query} />
                  </p>
                )}
                <span className="mt-auto flex items-center gap-1 pt-3 text-[13px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Open passage <ArrowRight className="size-3.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {results.length > INITIAL && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${results.length} passages`}
          </Button>
        </div>
      )}
    </section>
  );
}
