import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Download, Heart, Loader2, Printer, Star } from "lucide-react";
import { api } from "../api";
import { useAccount } from "./Account";
import { formatLanguage, initials, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import BookCover from "./library/BookCover";
import CategoryPicker from "./library/CategoryPicker";
import { InlineMessage } from "./common/States";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_SHELF = { favorite: false, wishlist: false, rating: null, review: "" };

function Stars({ value, size = "size-3.5" }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(size, n <= value ? "text-star" : "text-border")} fill="currentColor" />
      ))}
    </span>
  );
}

function RatingPicker({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? null : n)}
            className="rounded-md p-1 outline-none transition-transform hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <Star className={cn("size-6 transition-colors", n <= shown ? "text-star" : "text-border")} fill="currentColor" />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{value ? `${value} of 5` : "Unrated"}</span>
    </div>
  );
}

function ShelfToggle({ pressed, onClick, icon: Icon, label, activeClass }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-10 flex-1 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        pressed ? activeClass : "border-input bg-card text-foreground hover:bg-accent",
      )}
    >
      <Icon className="size-4" fill={pressed ? "currentColor" : "none"} />
      {label}
    </button>
  );
}

export default function BookDetails({ book, refresh, open, onOpenChange }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetTitle className="sr-only">{book.title}</SheetTitle>
        <SheetDescription className="sr-only">Book details, your shelves and reviews</SheetDescription>
        {open && <BookDetailsBody book={book} refresh={refresh} />}
      </SheetContent>
    </Sheet>
  );
}

function BookDetailsBody({ book, refresh }) {
  const { user, editor } = useAccount();
  const [form, setForm] = useState(null),
    [shelf, setShelf] = useState(EMPTY_SHELF),
    [reviews, setReviews] = useState(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    setForm({
      ...book,
      author_names:
        (book.authors || []).map((a) => a.name).join("; ") || book.author || "",
    });
    api
      .get(`/api/books/${book.slug}/reviews`)
      .then((d) => setReviews(d.reviews))
      .catch((e) => setError(e.message));
    if (user)
      api
        .get("/api/me")
        .then((d) =>
          setShelf(d.shelves.find((x) => x.book_id === book.id) || EMPTY_SHELF),
        )
        .catch((e) => setError(e.message));
  }, [book, user]);

  const field = (key, label, props) => (
    <Field label={label} htmlFor={`meta-${key}`} {...props}>
      <Input
        id={`meta-${key}`}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );

  async function exportAs(format) {
    setBusy(format);
    try {
      await api.download(book.slug, format);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const facts = [
    ["Publisher", book.publisher],
    ["Edition", book.edition],
    ["Published", book.published_year],
    ["ISBN", book.isbn],
    ["Language", formatLanguage(book.language)],
    ["Series", book.series && `${book.series}${book.volume ? `, volume ${book.volume}` : ""}`],
    ["Category", book.category_name && (book.category_parent_name ? `${book.category_parent_name} / ${book.category_name}` : book.category_name)],
    ["Contents", book.chapter_count > 0 && plural(book.chapter_count, "chapter")],
  ].filter(([, v]) => v);

  const notices = (
    <div className="grid gap-2 empty:hidden">
      {saved && <InlineMessage>{saved}</InlineMessage>}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-5 border-b px-6 pb-6 pt-7 pr-12">
        <div className="w-24 shrink-0">
          <BookCover book={book} />
        </div>
        <div className="min-w-0 pt-1">
          <h2 className="font-serif text-2xl font-medium leading-tight tracking-tight">{book.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {book.authors?.length
              ? book.authors.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ", "}
                    <Link to={`/authors/${a.id}`} className="text-foreground underline-offset-4 hover:text-primary hover:underline">
                      {a.name}
                    </Link>
                  </span>
                ))
              : book.author}
          </p>
          {book.category_name && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {book.category_parent_name ? `${book.category_parent_name} · ${book.category_name}` : book.category_name}
            </p>
          )}
          {book.status === "draft" && (
            <span className="mt-3 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
              Draft — editors only
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 overflow-x-auto px-6 pt-3 scrollbar-none">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {user && <TabsTrigger value="shelf">Your shelf</TabsTrigger>}
          <TabsTrigger value="reviews">
            Reviews{reviews?.length ? <span className="ml-1.5 text-muted-foreground">{reviews.length}</span> : null}
          </TabsTrigger>
          {editor && <TabsTrigger value="edit">Edit</TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
          <TabsContent value="overview" className="grid gap-7">
            {facts.length > 0 && (
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Take it with you
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button variant="outline" asChild>
                  <Link to={`/${book.slug}/print/all`}>
                    <Printer /> Print / PDF
                  </Link>
                </Button>
                <Button variant="outline" disabled={busy === "md"} onClick={() => exportAs("md")}>
                  {busy === "md" ? <Loader2 className="animate-spin" /> : <Download />} Markdown
                </Button>
                <Button variant="outline" disabled={busy === "epub"} onClick={() => exportAs("epub")}>
                  {busy === "epub" ? <Loader2 className="animate-spin" /> : <Download />} EPUB
                </Button>
              </div>
            </div>
            {notices}
          </TabsContent>

          {user && (
            <TabsContent value="shelf">
              <form
                className="grid gap-6"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaved("");
                  setError("");
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
                <div className="flex gap-2">
                  <ShelfToggle
                    pressed={shelf.favorite}
                    onClick={() => setShelf({ ...shelf, favorite: !shelf.favorite })}
                    icon={Heart}
                    label="Favorite"
                    activeClass="border-favorite/30 bg-favorite/10 text-favorite"
                  />
                  <ShelfToggle
                    pressed={shelf.wishlist}
                    onClick={() => setShelf({ ...shelf, wishlist: !shelf.wishlist })}
                    icon={Bookmark}
                    label="Wishlist"
                    activeClass="border-primary/30 bg-primary-soft text-primary-soft-foreground"
                  />
                </div>
                <Field label="Your rating">
                  <RatingPicker value={shelf.rating} onChange={(rating) => setShelf({ ...shelf, rating })} />
                </Field>
                <Field label="Public review" htmlFor="shelf-review" hint="Shown to everyone with your name.">
                  <Textarea
                    id="shelf-review"
                    rows={5}
                    maxLength={10000}
                    value={shelf.review || ""}
                    onChange={(e) => setShelf({ ...shelf, review: e.target.value })}
                    placeholder="What did you think?"
                  />
                </Field>
                {notices}
                <Button type="submit" className="justify-self-start">Save shelves & review</Button>
              </form>
            </TabsContent>
          )}

          <TabsContent value="reviews">
            {reviews === null ? (
              <p className="text-sm text-muted-foreground">Loading reviews…</p>
            ) : reviews.length === 0 ? (
              <p className="py-8 text-center text-[15px] text-muted-foreground">
                No reviews yet{user ? " — be the first from Your shelf." : "."}
              </p>
            ) : (
              <ul className="divide-y">
                {reviews.map((r, i) => (
                  <li key={i} className="flex gap-3.5 py-5 first:pt-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                      {initials(r.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-sm font-medium">{r.name}</span>
                        {r.rating && <Stars value={r.rating} />}
                      </div>
                      {r.review && (
                        <p className="mt-1.5 whitespace-pre-line font-serif text-[16px] leading-relaxed text-foreground/90">
                          {r.review}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {editor && form && (
            <TabsContent value="edit">
              <form
                className="grid gap-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaved("");
                  setError("");
                  try {
                    await api.patch(`/api/books/${book.slug}`, {
                      ...form,
                      author_names: form.author_names
                        .split(";")
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
                {field("title", "Title")}
                {field("author_names", "Authors", { hint: "Separate co-authors with semicolons." })}
                <div className="grid gap-5 sm:grid-cols-2">
                  {field("publisher", "Publisher")}
                  {field("edition", "Edition")}
                  {field("published_year", "Publication year")}
                  {field("isbn", "ISBN")}
                  {field("price", "Price")}
                  {field("language", "Language", { hint: "Code, e.g. en, ta, hi" })}
                  {field("series", "Series")}
                  {field("volume", "Volume")}
                </div>
                <CategoryPicker
                  value={form.category_id}
                  onChange={(category_id) => setForm({ ...form, category_id })}
                />
                <Field label="Publication">
                  <Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft — editors only</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {notices}
                <Button type="submit" className="justify-self-start">Save metadata</Button>
              </form>
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
