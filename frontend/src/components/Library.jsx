import { useAccount } from "./Account";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, List, Plus, SearchX, SlidersHorizontal, X } from "lucide-react";
import { api } from "../api";
import { formatLanguage, plural } from "@/lib/format";
import BookWizard from "./BookWizard";
import Navbar from "./common/Navbar";
import Pagination from "./common/Pagination";
import { EmptyState, ErrorState } from "./common/States";
import BookCover from "./library/BookCover";
import BookGrid from "./library/BookGrid";
import CategoryCard from "./library/CategoryCard";
import ContentResults from "./library/ContentResults";
import FilterPanel from "./library/FilterPanel";
import { BookGridSkeleton } from "./library/LoadingSkeleton";
import PersonalLibrary from "./library/PersonalLibrary";
import SearchBar from "./library/SearchBar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const PAGE_SIZE = 24;
const VIEW_KEY = "loony-library-view";
const SORTS = {
  title: "Title",
  author: "Author",
  recent: "Recently added",
  year: "Publication year",
};
const container = "mx-auto w-full max-w-[88rem] px-4 sm:px-6 lg:px-10";

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function HeroShelf({ books }) {
  if (!books) {
    return (
      <div className="flex items-end gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="aspect-[2/3] w-32 rounded-[3px_7px_7px_3px]" />
        ))}
      </div>
    );
  }
  const picks = books.slice(0, 3);
  if (picks.length === 0) return null;
  return (
    <div aria-hidden className="relative flex h-64 w-[26rem] items-end justify-center">
      {picks.map((b, i) => {
        const offset = i - (picks.length - 1) / 2;
        return (
          <div
            key={b.id}
            className="absolute bottom-0 w-36"
            style={{
              transform: `translateX(${offset * 118}px) translateY(${Math.abs(offset) * -10}px) rotate(${offset * 4}deg)`,
              zIndex: 3 - Math.abs(offset),
            }}
          >
            <BookCover book={b} className="shadow-book-hover" />
          </div>
        );
      })}
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { editor, user } = useAccount();
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ genre: "", language: "", shelf: "" });
  const [sort, setSort] = useState("title");
  const [view, setView] = useState(readView);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState("");
  const catalogRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(
      () =>
        api
          .get(`/api/search?q=${encodeURIComponent(query)}`)
          .then((d) => {
            if (!active) return;
            // The endpoint returns one row per matching block; show each
            // section once.
            const seen = new Set();
            setResults(d.results.filter((r) => !seen.has(r.section_id) && seen.add(r.section_id)));
          })
          .catch(() => {
            if (active) setResults([]);
          })
          .finally(() => active && setSearching(false)),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, user]);

  useEffect(() => {
    setError(null);
    api
      .books()
      .then((d) => setBooks(d.books))
      .catch((err) => setError(err.message));
  }, [user, reloadKey]);

  useEffect(() => {
    setMeError("");
    if (!user) return setMe(null);
    api
      .get("/api/me")
      .then(setMe)
      .catch((e) => setMeError(e.message));
  }, [user]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
  }, [view]);

  useEffect(() => setPage(1), [query, filters, sort]);

  const shelves = useMemo(
    () => Object.fromEntries((me?.shelves || []).map((s) => [s.book_id, s])),
    [me],
  );
  const reading = useMemo(
    () => Object.fromEntries((me?.reading || []).map((r) => [r.book_id, r])),
    [me],
  );
  const booksById = useMemo(
    () => Object.fromEntries((books || []).map((b) => [b.id, b])),
    [books],
  );

  const facets = useMemo(() => {
    const all = books || [];
    const count = (values) => {
      const map = new Map();
      for (const v of values) map.set(v, (map.get(v) || 0) + 1);
      return [...map].sort((a, b) => a[0].localeCompare(b[0]));
    };
    return {
      total: all.length,
      genres: count(all.flatMap((b) => b.genres || [])),
      languages: count(all.map((b) => b.language))
        .filter(([code]) => formatLanguage(code))
        .map(([code, n]) => [code, formatLanguage(code), n]),
      shelves: user
        ? {
            reading: all.filter((b) => reading[b.id]).length,
            favorite: all.filter((b) => shelves[b.id]?.favorite).length,
            wishlist: all.filter((b) => shelves[b.id]?.wishlist).length,
          }
        : null,
    };
  }, [books, user, shelves, reading]);
  const hasFacets =
    Boolean(facets.shelves) || facets.genres.length > 0 || facets.languages.length > 1;

  const filtered = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    const { genre, language, shelf } = filters;
    return books
      .filter(
        (b) =>
          (!q ||
            b.title.toLowerCase().includes(q) ||
            b.author?.toLowerCase().includes(q) ||
            b.series?.toLowerCase().includes(q)) &&
          (!genre || b.genres.includes(genre)) &&
          (!language || b.language === language) &&
          (!shelf || (shelf === "reading" ? reading[b.id] : shelves[b.id]?.[shelf])),
      )
      .sort((a, b) =>
        sort === "recent"
          ? new Date(b.created_at) - new Date(a.created_at)
          : sort === "author"
            ? (a.author || "").localeCompare(b.author || "")
            : sort === "year"
              ? (b.published_year || 0) - (a.published_year || 0)
              : a.title.localeCompare(b.title),
      );
  }, [books, query, filters, sort, shelves, reading]);

  const pageCount = filtered ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1;
  const pageBooks = filtered?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeChips = [
    filters.shelf && { key: "shelf", label: { reading: "Reading", favorite: "Favorites", wishlist: "Wishlist" }[filters.shelf] },
    filters.genre && { key: "genre", label: filters.genre },
    filters.language && { key: "language", label: formatLanguage(filters.language) },
  ].filter(Boolean);
  const heading = query.trim() ? "Results" : activeChips.length === 1 ? activeChips[0].label : "All books";
  const showGenres = !query.trim() && activeChips.length === 0 && facets.genres.length >= 3;

  function changePage(p) {
    setPage(p);
    catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearAll() {
    setQuery("");
    setFilters({ genre: "", language: "", shelf: "" });
  }

  // Creates the book, then its opening chapters in order (each one also
  // gets its own initial section - see POST /books/:slug/chapters), and
  // lands you straight in the first chapter's editor if there is one -
  // otherwise the book's (empty) home page, same as any other book that's
  // had all its chapters removed.
  async function handleFinishWizard({
    title,
    chapters,
    coverFile,
    ...metadata
  }) {
    const { book } = await api.createBook({ title, coverFile, ...metadata });

    let firstSectionId = null;
    for (const chapterTitle of chapters) {
      const { section } = await api.createChapter(book.slug, {
        title: chapterTitle,
      });
      firstSectionId ??= section.id;
    }

    setCreating(false);
    if (firstSectionId) {
      navigate(`/${book.slug}/sections/${firstSectionId}`, {
        state: { autoEdit: true },
      });
    } else {
      navigate(`/${book.slug}`);
    }
  }

  const stats = books && [
    plural(books.length, "book"),
    plural(new Set(books.flatMap((b) => b.authors?.map((a) => a.id) || [])).size, "author"),
    plural(books.reduce((n, b) => n + (b.chapter_count || 0), 0), "chapter"),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className={`${container} grid items-center gap-12 pb-12 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:pb-16 lg:pt-20`}>
          <div className="max-w-2xl">
            <h1 className="font-serif text-[2.6rem] font-normal leading-[1.05] tracking-[-0.02em] text-balance sm:text-6xl lg:text-[4.25rem]">
              A home for <em className="text-primary">every</em> book.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
              Read, annotate and publish books in any language, for any community — all in one quiet place.
            </p>
            <SearchBar
              className="mt-8 max-w-xl"
              label="Search the library"
              placeholder="Search books, authors or passages…"
              value={query}
              onChange={setQuery}
            />
            <p className="mt-4 h-5 text-[13px] text-muted-foreground">
              {stats ? stats.join("  ·  ") : ""}
            </p>
          </div>
          <div className="hidden justify-center lg:flex lg:pr-6">
            <HeroShelf books={books} />
          </div>
        </section>

        {user && (
          <PersonalLibrary user={user} me={me} error={meError} booksById={booksById} />
        )}

        {showGenres && (
          <section aria-labelledby="browse-genres" className={`${container} pt-12`}>
            <h2 id="browse-genres" className="mb-5 font-serif text-2xl font-medium tracking-tight">
              Browse by genre
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
              {facets.genres.slice(0, 8).map(([g]) => (
                <CategoryCard
                  key={g}
                  name={g}
                  books={books.filter((b) => b.genres.includes(g))}
                  onSelect={() => {
                    setFilters((f) => ({ ...f, genre: g }));
                    catalogRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Catalogue */}
        <section
          ref={catalogRef}
          aria-labelledby="catalog-heading"
          className={`${container} scroll-mt-20 pb-24 pt-12 lg:pt-14`}
        >
          <div className="flex gap-12">
            {hasFacets && books && (
              <aside className="hidden w-56 shrink-0 lg:block">
                <div className="sticky top-24">
                  <FilterPanel facets={facets} filters={filters} onChange={setFilters} />
                </div>
              </aside>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-5">
                <div className="min-w-0">
                  <h2 id="catalog-heading" className="font-serif text-3xl font-medium tracking-tight">
                    {heading}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span aria-live="polite">
                      {filtered ? plural(filtered.length, "title") : "Loading…"}
                      {query.trim() && <> for “{query.trim()}”</>}
                    </span>
                    {activeChips.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setFilters((f) => ({ ...f, [c.key]: "" }))}
                        className="inline-flex h-6 items-center gap-1 rounded-full bg-primary-soft pl-2.5 pr-1.5 text-xs font-medium text-primary-soft-foreground transition-colors hover:bg-primary-soft/70"
                        aria-label={`Remove filter ${c.label}`}
                      >
                        {c.label}
                        <X className="size-3" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hasFacets && (
                    <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
                      <SlidersHorizontal />
                      Filters
                      {activeChips.length > 0 && (
                        <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                          {activeChips.length}
                        </span>
                      )}
                    </Button>
                  )}
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="h-8 w-auto gap-1.5 border-transparent bg-transparent px-2.5 text-[13px] shadow-none hover:bg-accent" aria-label="Sort books">
                      <span className="text-muted-foreground">Sort:</span>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {Object.entries(SORTS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ToggleGroup
                    type="single"
                    value={view}
                    onValueChange={(v) => v && setView(v)}
                    aria-label="Layout"
                  >
                    <ToggleGroupItem value="grid" aria-label="Grid view">
                      <LayoutGrid />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="list" aria-label="List view">
                      <List />
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {editor && (
                    <Button size="sm" onClick={() => setCreating(true)} className="ml-1">
                      <Plus />
                      New book
                    </Button>
                  )}
                </div>
              </div>

              {error ? (
                <ErrorState
                  title="The library couldn’t load"
                  message={error}
                  onRetry={() => {
                    setBooks(null);
                    setReloadKey((k) => k + 1);
                  }}
                />
              ) : !filtered ? (
                <BookGridSkeleton view={view} />
              ) : filtered.length === 0 ? (
                books.length === 0 ? (
                  <EmptyState
                    title="The shelves are empty"
                    description={editor ? "Start the collection with the first book." : "No books have been published yet. Check back soon."}
                    action={
                      editor && (
                        <Button onClick={() => setCreating(true)}>
                          <Plus /> New book
                        </Button>
                      )
                    }
                  />
                ) : (
                  <EmptyState
                    icon={SearchX}
                    title="No books match"
                    description={
                      query.trim()
                        ? `Nothing in the catalogue matches “${query.trim()}”${activeChips.length ? " with these filters" : ""}.`
                        : "No books match these filters."
                    }
                    action={
                      <Button variant="outline" onClick={clearAll}>
                        Clear search and filters
                      </Button>
                    }
                  />
                )
              ) : (
                <div key={`${view}-${page}`} className="animate-in fade-in-0 duration-300">
                  <BookGrid books={pageBooks} view={view} shelves={shelves} reading={reading} />
                </div>
              )}

              <Pagination page={page} pageCount={pageCount} onPageChange={changePage} className="mt-14" />

              {query.trim() && (
                <ContentResults key={query.trim()} query={query} results={results} loading={searching} />
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className={`${container} no-print`}>
        <div className="flex flex-col gap-2 border-t py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="font-serif text-[15px] text-foreground">Loony Library</span>
          <span>A home for every book — any language, any community.</span>
        </div>
      </footer>

      {hasFacets && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>{filtered ? plural(filtered.length, "title") : ""}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-3 py-6">
              <FilterPanel facets={facets} filters={filters} onChange={setFilters} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {creating && (
        <BookWizard
          onFinish={handleFinishWizard}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
