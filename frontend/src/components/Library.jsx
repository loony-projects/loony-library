import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Library() {
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .books()
      .then((d) => setBooks(d.books))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">Couldn't load the library: {error}</p>;
  if (!books) return <p className="loading">Loading…</p>;

  return (
    <div className="library">
      <h1>Loony Library</h1>
      <ul className="library-books">
        {books.map((b) => (
          <li key={b.id}>
            <Link to={`/${b.slug}`} className="library-book">
              <span className="library-book-title">{b.title}</span>
              {b.author && <span className="library-book-author">{b.author}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
