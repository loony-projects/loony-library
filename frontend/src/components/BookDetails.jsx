import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "./Account";
export default function BookDetails({ book, refresh }) {
  const { user, editor } = useAccount();
  const [form, setForm] = useState(null),
    [shelf, setShelf] = useState({
      favorite: false,
      wishlist: false,
      rating: null,
      review: "",
    }),
    [reviews, setReviews] = useState([]),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  useEffect(() => {
    setForm({
      ...book,
      author_names:
        (book.authors || []).map((a) => a.name).join("; ") || book.author || "",
      genres: (book.genres || []).join(", "),
    });
    api
      .get(`/api/books/${book.slug}/reviews`)
      .then((d) => setReviews(d.reviews))
      .catch((e) => setError(e.message));
    if (user)
      api
        .get("/api/me")
        .then((d) =>
          setShelf(
            d.shelves.find((x) => x.book_id === book.id) || {
              favorite: false,
              wishlist: false,
              rating: null,
              review: "",
            },
          ),
        )
        .catch((e) => setError(e.message));
  }, [book, user]);
  const field = (key, label) => (
    <label>
      {label}
      <input
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <details className="panel no-print">
      <summary>Book details & actions</summary>
      <p>
        <Link to={`/${book.slug}/print/all`}>Print entire book / PDF</Link>
      </p>
      <p>
        {book.language} · {book.genres?.join(", ")}{" "}
        {book.series && `· ${book.series}, volume ${book.volume || "—"}`}
      </p>
      {book.authors?.map((a) => (
        <p key={a.id}>
          <Link to={`/authors/${a.id}`}>{a.name}</Link>
        </p>
      ))}
      <button
        onClick={() =>
          api.download(book.slug, "md").catch((e) => setError(e.message))
        }
      >
        Export Markdown
      </button>
      <button
        onClick={() =>
          api.download(book.slug, "epub").catch((e) => setError(e.message))
        }
      >
        Export EPUB
      </button>
      {editor && form && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.patch(`/api/books/${book.slug}`, {
                ...form,
                author_names: form.author_names
                  .split(";")
                  .map((x) => x.trim())
                  .filter(Boolean),
                genres: form.genres
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
                volume: form.volume ? Number(form.volume) : null,
              });
              await refresh();
              setSaved("Metadata saved");
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <h3>Edit metadata</h3>
          {field("title", "Title")}
          {field("publisher", "Publisher")}
          {field("isbn", "ISBN")}
          {field("edition", "Edition")}
          {field("published_year", "Publication year")}
          {field("price", "Price")}
          {field("author_names", "Authors (separate with semicolons)")}
          {field("language", "Language (e.g. en, ta, hi)")}
          {field("genres", "Genres (comma separated)")}
          {field("series", "Series")}
          {field("volume", "Volume")}
          <label>
            Publication
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="draft">Draft — editors only</option>
              <option value="published">Published</option>
            </select>
          </label>
          <button>Save metadata</button>
        </form>
      )}
      {user && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.put(`/api/me/shelves/${book.id}`, shelf);
              setSaved("Your review and shelves are saved");
              const d = await api.get(`/api/books/${book.slug}/reviews`);
              setReviews(d.reviews);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <h3>Your shelves & review</h3>
          <label>
            <input
              type="checkbox"
              checked={shelf.favorite}
              onChange={(e) =>
                setShelf({ ...shelf, favorite: e.target.checked })
              }
            />
            Favorite
          </label>
          <label>
            <input
              type="checkbox"
              checked={shelf.wishlist}
              onChange={(e) =>
                setShelf({ ...shelf, wishlist: e.target.checked })
              }
            />
            Wishlist
          </label>
          <label>
            Rating
            <select
              value={shelf.rating ?? ""}
              onChange={(e) =>
                setShelf({
                  ...shelf,
                  rating: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">Unrated</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Public review
            <textarea
              maxLength={10000}
              value={shelf.review}
              onChange={(e) => setShelf({ ...shelf, review: e.target.value })}
            />
          </label>
          <button>Save shelves & review</button>
        </form>
      )}
      <h3>Reader reviews</h3>
      {reviews.map((r, i) => (
        <p key={i}>
          <strong>{r.name}</strong> {r.rating && `${r.rating}/5`} — {r.review}
        </p>
      ))}
      {saved && <p role="status">{saved}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
