import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api";
import { coverGradient } from "../coverArt";

function BookCard({ book }) {
  return (
    <Link to={`/${book.slug}`} className="library-card">
      <div className="library-card-cover" style={{ background: coverGradient(book.slug) }}>
        <span className="library-card-initial">{book.title.charAt(0).toUpperCase()}</span>
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
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

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

      {books && filtered.length > 0 && (
        <div className="library-grid">
          {filtered.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}

      {books && filtered.length === 0 && (
        <p className="library-empty">No books match "{query}".</p>
      )}
    </div>
  );
}
