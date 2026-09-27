import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "./Account";
export default function AuthorPage() {
  const { authorId } = useParams();
  const { editor } = useAccount();
  const [author, setAuthor] = useState(null),
    [books, setBooks] = useState([]),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  useEffect(() => {
    Promise.all([api.get(`/api/authors/${authorId}`), api.books()])
      .then(([a, d]) => {
        setAuthor(a);
        setBooks(
          d.books.filter((b) => b.authors.some((a) => a.id === authorId)),
        );
      })
      .catch((e) => setError(e.message));
  }, [authorId]);
  return (
    <main className="library">
      <Link to="/">← Library</Link>
      {error && <p role="alert">{error}</p>}
      {author && (
        <>
          <h1>{author.name}</h1>
          {author.photo_url && (
            <img width="160" src={author.photo_url} alt={author.name} />
          )}
          <p>{author.bio}</p>
          <h2>Books</h2>
          {books.map((b) => (
            <p key={b.id}>
              <Link to={`/${b.slug}`}>{b.title}</Link>
            </p>
          ))}
          {editor && (
            <form
              className="panel"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.put(`/api/authors/${authorId}`, author);
                  setSaved("Author saved");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              {["name", "bio", "photo_url"].map((k) => (
                <label key={k}>
                  {k.replace("_", " ")}
                  <input
                    value={author[k] || ""}
                    onChange={(e) =>
                      setAuthor({ ...author, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
              <button>Save author</button>
              <p role="status">{saved}</p>
            </form>
          )}
        </>
      )}
    </main>
  );
}
