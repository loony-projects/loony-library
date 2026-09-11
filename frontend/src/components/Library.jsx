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
        style={book.cover_image ? undefined : { background: coverGradient(book.slug) }}
      >
        {book.cover_image ? (
          <img className="library-card-cover-img" src={api.coverUrl(book.cover_image)} alt="" />
        ) : (
          <span className="library-card-initial">{book.title.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="library-card-body">
        <span className="library-card-title">{book.title}</span>
        {book.author && <span className="library-card-author">{book.author}</span>}
        <div className="library-card-meta">
          {book.chapter_count > 0 && (
            <span className="library-card-badge">
              {book.chapter_count} chapter{book.chapter_count === 1 ? "" : "s"}
            </span>
          )}
          {book.published_year && <span className="library-card-badge">{book.published_year}</span>}
        </div>
      </div>
    </Link>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .books()
      .then((d) => setBooks(d.books))
      .catch((err) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) => b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q));
  }, [books, query]);

  // Creates the book, then its opening chapters in order (each one also
  // gets its own initial section - see POST /books/:slug/chapters), and
  // lands you straight in the first chapter's editor if there is one -
  // otherwise the book's (empty) home page, same as any other book that's
  // had all its chapters removed.
  async function handleFinishWizard({ title, chapters, coverFile, ...metadata }) {
    const { book } = await api.createBook({ title, coverFile, ...metadata });

    let firstSectionId = null;
    for (const chapterTitle of chapters) {
      const { section } = await api.createChapter(book.slug, { title: chapterTitle });
      firstSectionId ??= section.id;
    }

    setCreating(false);
    if (firstSectionId) {
      navigate(`/${book.slug}/sections/${firstSectionId}`, { state: { autoEdit: true } });
    } else {
      navigate(`/${book.slug}`);
    }
  }

  if (error) return <p className="error">Couldn't load the library: {error}</p>;

  return (
    <div className="library">
      <header className="library-hero">
        <h1>Loony Library</h1>
        <p className="library-tagline">A home for every book — any language, any community.</p>
        <div className="library-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search books or authors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {!books && <p className="loading">Loading…</p>}

      {books && (
        <>
          <div className="library-grid">
            <button type="button" className="library-card library-card--add" onClick={() => setCreating(true)}>
              <Plus size={26} />
              <span>New book</span>
            </button>
            {filtered.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
          {filtered.length === 0 && <p className="library-empty">No books match "{query}".</p>}
        </>
      )}

      {creating && <BookWizard onFinish={handleFinishWizard} onCancel={() => setCreating(false)} />}
    </div>
  );
}
