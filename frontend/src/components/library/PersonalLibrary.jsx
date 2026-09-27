import { useState } from "react";
import { ArrowRight, Bookmark, Heart, Highlighter, NotebookPen } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BookCover from "./BookCover";

function ShelfTile({ to, book, title, subtitle, children }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-lg border bg-card p-3 pr-4 transition-[border-color,box-shadow] duration-200 outline-none hover:border-input hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <div className="w-12 shrink-0">
        <BookCover book={book} className="shadow-sm" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-[16px] font-medium leading-snug group-hover:text-primary">
          {title}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>
        {children}
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

function Empty({ children }) {
  return <p className="py-6 text-[15px] text-muted-foreground">{children}</p>;
}

const KIND_ICON = { bookmark: Bookmark, highlight: Highlighter, note: NotebookPen };

// Signed-in reader's shelf: resume points, saved books and annotations.
export default function PersonalLibrary({ user, me, error, booksById }) {
  const [allNotes, setAllNotes] = useState(false);
  const bookFor = (row) =>
    booksById[row.book_id] || { slug: row.slug, title: row.title || row.book_title };
  const saved = me?.shelves.filter((x) => x.favorite || x.wishlist) || [];
  const notes = me?.annotations || [];
  const firstName = user.name.split(" ")[0];
  return (
    <section aria-labelledby="your-reading" className="mx-auto max-w-[88rem] px-4 pb-4 sm:px-6 lg:px-10">
      <div className="rounded-2xl bg-secondary/60 px-5 py-7 sm:px-8 sm:py-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-primary">Your reading</p>
        <h2 id="your-reading" className="mt-1.5 font-serif text-3xl font-medium tracking-tight">
          Welcome back, {firstName}
        </h2>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <Tabs defaultValue="continue" className="mt-6">
          <TabsList className="overflow-x-auto scrollbar-none">
            <TabsTrigger value="continue">Continue reading</TabsTrigger>
            <TabsTrigger value="saved">
              Saved{saved.length > 0 && <span className="ml-1.5 text-muted-foreground">{saved.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="notes">
              Notes & highlights
              {notes.length > 0 && <span className="ml-1.5 text-muted-foreground">{notes.length}</span>}
            </TabsTrigger>
          </TabsList>
          {!me && !error ? (
            <div className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[5.6rem] rounded-lg" />
              ))}
            </div>
          ) : (
            me && (
              <>
                <TabsContent value="continue" className="pt-5">
                  {me.reading.length === 0 ? (
                    <Empty>Open any section and your place will be kept here.</Empty>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {me.reading.slice(0, 6).map((x) => (
                        <ShelfTile
                          key={x.book_id}
                          to={`/${x.slug}/sections/${x.section_id}`}
                          book={bookFor(x)}
                          title={x.title}
                          subtitle={x.section_title}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="saved" className="pt-5">
                  {saved.length === 0 ? (
                    <Empty>Mark books as favorites or add them to your wishlist from a book’s details.</Empty>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {saved.map((x) => (
                        <ShelfTile key={x.book_id} to={`/${x.slug}`} book={bookFor(x)} title={x.title} subtitle={booksById[x.book_id]?.author || ""}>
                          <div className="mt-2 flex gap-1.5">
                            {x.favorite && (
                              <Badge variant="secondary" className="bg-favorite/12 text-favorite">
                                <Heart fill="currentColor" /> Favorite
                              </Badge>
                            )}
                            {x.wishlist && (
                              <Badge>
                                <Bookmark fill="currentColor" /> Wishlist
                              </Badge>
                            )}
                          </div>
                        </ShelfTile>
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="notes" className="pt-3">
                  {notes.length === 0 ? (
                    <Empty>Bookmarks, highlights and notes you make while reading appear here.</Empty>
                  ) : (
                    <>
                      <ul className="divide-y">
                        {(allNotes ? notes : notes.slice(0, 4)).map((x) => {
                          const Icon = KIND_ICON[x.kind] || NotebookPen;
                          return (
                            <li key={x.id}>
                              <Link
                                to={`/${x.slug}/sections/${x.section_id}`}
                                className="group flex gap-4 py-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring rounded-md"
                              >
                                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-primary shadow-xs">
                                  <Icon className="size-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[13px] text-muted-foreground">
                                    <span className="capitalize">{x.kind}</span> in{" "}
                                    <span className="font-medium text-foreground group-hover:text-primary">{x.book_title}</span>
                                  </p>
                                  {x.quote && (
                                    <p className="mt-1 line-clamp-2 font-serif text-[16px] italic leading-relaxed">“{x.quote}”</p>
                                  )}
                                  {x.note && <p className="mt-1 line-clamp-2 text-sm text-foreground/85">{x.note}</p>}
                                </div>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {notes.length > 4 && (
                        <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setAllNotes((v) => !v)}>
                          {allNotes ? "Show fewer" : `Show all ${notes.length}`}
                        </Button>
                      )}
                    </>
                  )}
                </TabsContent>
              </>
            )
          )}
        </Tabs>
      </div>
    </section>
  );
}
