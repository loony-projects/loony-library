import Account, { useAccount } from "./Account";
import { PersonalLibrary, Preferences } from "./ReadingTools";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { api } from "../api";
import { coverGradient } from "../coverArt";
import BookWizard from "./BookWizard";

function BookCard({ book }) {
  return (
    <Link to={`/${book.slug}`} className="library-card">
      <div
        className="library-card-cover"
        style={
          book.cover_image
            ? undefined
            : { background: coverGradient(book.slug) }
        }
      >
        {book.cover_image ? (
          <img
            className="library-card-cover-img"
            src={api.coverUrl(book.cover_image)}
            alt=""
          />
        ) : (
          <span className="library-card-initial">
            {book.title.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="library-card-body">
        <span className="library-card-title">{book.title}</span>
        {book.author && (
          <span className="library-card-author">{book.author}</span>
        )}
        <div className="library-card-meta">
          {book.chapter_count > 0 && (
            <span className="library-card-badge">
              {book.chapter_count} chapter{book.chapter_count === 1 ? "" : "s"}
            </span>
          )}
          {book.status === "draft" && (
            <span className="library-card-badge">Draft</span>
          )}
          <span className="library-card-badge">{book.language}</span>
          {book.series && (
            <span>
              {book.series} · {book.volume}
            </span>
          )}
          {book.published_year && (
            <span className="library-card-badge">{book.published_year}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { editor, user } = useAccount();
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [genre, setGenre] = useState(""),
    [language, setLanguage] = useState(""),
    [sort, setSort] = useState("title"),
    [results, setResults] = useState([]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api
          .get(`/api/search?q=${encodeURIComponent(query)}`)
          .then((d) => {
            if (active) setResults(d.results);
          })
          .catch(() => {
            if (active) setResults([]);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, user]);

  useEffect(() => {
    api
      .books()
      .then((d) => setBooks(d.books))
      .catch((err) => setError(err.message));
  }, [user]);

  const filtered = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    return books
      .filter(
        (b) =>
          (!q ||
            b.title.toLowerCase().includes(q) ||
            b.author?.toLowerCase().includes(q) ||
            b.series?.toLowerCase().includes(q)) &&
          (!genre || b.genres.includes(genre)) &&
          (!language || b.language === language),
      )
      .sort((a, b) =>
        sort === "recent"
          ? new Date(b.created_at) - new Date(a.created_at)
          : sort === "author"
            ? (a.author || "").localeCompare(b.author || "")
            : a.title.localeCompare(b.title),
      );
  }, [books, query, genre, language, sort]);

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

  if (error) return <p className="error">Couldn't load the library: {error}</p>;

  return (
    <div className="library">
      <Account />
      <Preferences />
      <header className="library-hero">
        <h1>Loony Library</h1>
        <p className="library-tagline">
          A home for every book — any language, any community.
        </p>
        <div className="library-search">
          <Search size={16} />
          <input
            type="text"
            aria-label="Search the library"
            placeholder="Search books, authors, series or content…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <PersonalLibrary />
      {books && (
        <div className="filters">
          <label>
            Genre
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">All genres</option>
              {[...new Set(books.flatMap((b) => b.genres))].sort().map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            Language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="">All languages</option>
              {[...new Set(books.map((b) => b.language))].sort().map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="title">Title</option>
              <option value="author">Author</option>
              <option value="recent">Recently added</option>
            </select>
          </label>
        </div>
      )}
      {query.trim() && (
        <section>
          <h2>Inside the books</h2>
          {results.map((r, i) => (
            <p key={`${r.section_id}-${i}`}>
              <Link to={`/${r.book_slug}/sections/${r.section_id}`}>
                {r.book_title} — {r.title}
              </Link>
              <br />
              {r.snippet}
            </p>
          ))}
          {!results.length && <p>No content matches.</p>}
        </section>
      )}
      {!books && <p className="loading">Loading…</p>}

      {books && (
        <>
          <div className="library-grid">
            {editor && (
              <button
                type="button"
                className="library-card library-card--add"
                onClick={() => setCreating(true)}
              >
                <Plus size={26} />
                <span>New book</span>
              </button>
            )}
            {filtered.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="library-empty">No books match "{query}".</p>
          )}
        </>
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
