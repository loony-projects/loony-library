import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { Search } from "lucide-react";
import { api } from "../api";
import ReadingSkeleton from "./common/ReadingSkeleton";
import { EmptyState, ErrorState } from "./common/States";

// A dictionary can have 10,000 terms: only this many are listed until a
// filter narrows them.
const MAX_LISTED = 300;

export default function GlossaryPage() {
  const { bookSlug } = useParams();
  const { book } = useOutletContext() ?? {};
  const label = /glossary|dictionar/.test(book?.category_slug ?? "") ? "All terms" : "Abbreviations";
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setTerms(null);
    setError(null);
    api
      .glossary(bookSlug)
      .then((d) => setTerms(d.terms))
      .catch((e) => setError(e.message));
  }, [bookSlug]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!terms || !q) return terms;
    return terms.filter(
      (t) => t.term.toLowerCase().includes(q) || t.expansion.toLowerCase().includes(q),
    );
  }, [terms, filter]);

  if (error) return <ErrorState title={`Couldn’t load ${label.toLowerCase()}`} message={error} />;
  if (!terms) return <ReadingSkeleton />;

  return (
    <article className="animate-in fade-in-0 duration-300">
      <header className="mb-8 border-b pb-6">
        <p className="mb-3 text-[13px] font-semibold tracking-wide text-primary">Reference</p>
        <h1 className="font-serif text-[2.75rem] font-medium leading-tight tracking-[-0.015em]">
          {label}
        </h1>
        {terms.length > 8 && (
          <div className="relative mt-6 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label={`Filter ${label.toLowerCase()}`}
              placeholder={`Filter ${terms.length} terms…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm shadow-xs outline-none focus:border-primary/50 focus:ring-[3px] focus:ring-ring"
            />
          </div>
        )}
      </header>
      {shown.length === 0 ? (
        <EmptyState title="No terms" description={terms.length ? "Nothing matches that filter." : `This book has no ${label.toLowerCase()}.`} />
      ) : (
        <dl className="divide-y">
          {shown.slice(0, MAX_LISTED).map((t, i) => (
            <div key={i} className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:gap-6">
              <dt className="font-mono text-[14px] font-semibold text-primary">{t.term}</dt>
              <dd
                className="font-serif text-[17px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.expansion) }}
              />
            </div>
          ))}
        </dl>
      )}
      {shown.length > MAX_LISTED && (
        <p className="mt-6 text-sm text-muted-foreground">
          Showing the first {MAX_LISTED} of {shown.length} terms. Type in the filter above to find one.
        </p>
      )}
    </article>
  );
}
