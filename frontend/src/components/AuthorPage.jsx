import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../api";
import { useAccount } from "./Account";
import { initials, plural } from "@/lib/format";
import Navbar from "./common/Navbar";
import { EmptyState, ErrorState, InlineMessage } from "./common/States";
import BookGrid from "./library/BookGrid";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-[88rem] px-4 pb-24 pt-8 sm:px-6 lg:px-10">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeft /> Library
          </Link>
        </Button>
        {error && !author && <ErrorState message={error} />}
        {!author && !error && (
          <div className="mt-10 flex items-center gap-6">
            <Skeleton className="size-24 rounded-full" />
            <div className="space-y-3">
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        )}
        {author && (
          <>
            <header className="mt-10 flex flex-col gap-6 border-b pb-10 sm:flex-row sm:items-center sm:gap-8">
              {author.photo_url ? (
                <img
                  src={author.photo_url}
                  alt={author.name}
                  className="size-24 shrink-0 rounded-full object-cover shadow-md sm:size-28"
                />
              ) : (
                <span className="flex size-24 shrink-0 items-center justify-center rounded-full bg-primary-soft font-serif text-3xl text-primary-soft-foreground sm:size-28">
                  {initials(author.name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-wide text-primary">Author</p>
                <h1 className="mt-1 font-serif text-4xl font-medium tracking-tight sm:text-5xl">
                  {author.name}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">{plural(books.length, "book")} in the library</p>
              </div>
            </header>
            <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0">
                {author.bio && (
                  <p className="mb-12 max-w-2xl whitespace-pre-line font-serif text-xl leading-relaxed text-foreground/90">
                    {author.bio}
                  </p>
                )}
                <h2 className="mb-6 font-serif text-2xl font-medium tracking-tight">Books</h2>
                {books.length ? (
                  <BookGrid books={books} />
                ) : error ? null : (
                  <EmptyState title="No books yet" className="py-10" />
                )}
              </div>
              {editor && (
                <aside>
                  <form
                    className="sticky top-24 grid gap-5 rounded-xl border bg-card p-6 shadow-xs"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaved("");
                      try {
                        await api.put(`/api/authors/${authorId}`, author);
                        setSaved("Author saved");
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    <h2 className="font-serif text-xl font-medium">Edit author</h2>
                    <Field label="Name" htmlFor="author-name">
                      <Input
                        id="author-name"
                        value={author.name || ""}
                        onChange={(e) => setAuthor({ ...author, name: e.target.value })}
                      />
                    </Field>
                    <Field label="Biography" htmlFor="author-bio">
                      <Textarea
                        id="author-bio"
                        rows={6}
                        value={author.bio || ""}
                        onChange={(e) => setAuthor({ ...author, bio: e.target.value })}
                      />
                    </Field>
                    <Field label="Photo URL" htmlFor="author-photo" hint="An https:// image link.">
                      <Input
                        id="author-photo"
                        value={author.photo_url || ""}
                        onChange={(e) => setAuthor({ ...author, photo_url: e.target.value })}
                      />
                    </Field>
                    <InlineMessage>{saved}</InlineMessage>
                    <InlineMessage tone="error">{error}</InlineMessage>
                    <Button type="submit" className="justify-self-start">Save author</Button>
                  </form>
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
