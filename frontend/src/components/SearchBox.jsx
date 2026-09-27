import { useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api";

export default function SearchBox({ onNavigate }) {
  const { bookSlug } = useParams();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const navigate = useNavigate();

  function onChange(e) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const data = await api.search(bookSlug, value);
      setResults(data.results);
      setOpen(true);
    }, 250);
  }

  function goTo(sectionId) {
    setOpen(false);
    setQ("");
    navigate(`/${bookSlug}/sections/${sectionId}`);
    onNavigate?.();
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label="Search this book"
        placeholder="Search this book…"
        value={q}
        onChange={onChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm shadow-xs transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/80 focus:border-primary/50 focus:ring-[3px] focus:ring-ring"
      />
      {open && (
        <ul className="absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-[60vh] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-[0.98] scrollbar-thin">
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">No matches</li>
          )}
          {results.map((r) => (
            <li key={r.section_id}>
              <button
                onMouseDown={() => goTo(r.section_id)}
                className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {r.chapter_title}{" "}
                  {r.numbering ? `– ${r.numbering} ${r.title}` : ""}
                </div>
                <div
                  className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
