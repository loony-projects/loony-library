import AccountMenu, { useAccount } from "./Account";
import { ReadingSettings, ThemeToggle } from "./Preferences";
import BookDetails from "./BookDetails";
import OutlineEditor from "./OutlineEditor";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ArrowLeft, BookText, Info, ListTree, Menu, Plus } from "lucide-react";
import { api } from "../api";
import TocTree from "./TocTree";
import SearchBox from "./SearchBox";
import NewItemDialog from "./NewItemDialog";
import BookCover from "./library/BookCover";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";

// Flattens every section id in the TOC (at any depth) into one set, so a
// delete handler can tell whether the section currently being viewed still
// exists afterward - it might not, either because it was the one deleted or
// because an ancestor of it was.
function collectSectionIds(chapters) {
  const ids = new Set();
  function walk(sections) {
    for (const s of sections) {
      ids.add(s.id);
      walk(s.children);
    }
  }
  for (const c of chapters) walk(c.sections);
  return ids;
}

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_SIDEBAR_WIDTH = 300;
const SIDEBAR_WIDTH_KEY = "loony-library-sidebar-width";

function readStoredWidth() {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH)
      return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) - fall through to default
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

// Book identity, search and contents; shared by the desktop sidebar and
// the mobile drawer.
function BookSidebar({ book, bookSlug, toc, error, editor, onCreate, tocHandlers, onNavigate }) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-5">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" />
          Library
        </Link>
        <Link
          to={`/${bookSlug}`}
          onClick={onNavigate}
          className="group mt-5 flex items-start gap-3.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {book ? (
            <>
              <div className="w-12 shrink-0">
                <BookCover book={book} className="shadow-sm" />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="font-serif text-[17px] font-medium leading-snug group-hover:text-primary">
                  {book.title}
                </p>
                {book.author && (
                  <p className="mt-1 truncate text-[13px] text-muted-foreground">{book.author}</p>
                )}
              </div>
            </>
          ) : (
            <>
              <Skeleton className="aspect-[2/3] w-12 shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </>
          )}
        </Link>
        <div className="mt-5">
          <SearchBox onNavigate={onNavigate} />
        </div>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2.5 pb-6 pt-2 scrollbar-thin">
        {error && (
          <p role="alert" className="px-2.5 text-sm text-destructive">
            Couldn't load the table of contents: {error}
          </p>
        )}
        {toc ? (
          <TocTree chapters={toc.chapters} {...tocHandlers} />
        ) : (
          !error && (
            <div className="grid gap-2.5 px-2.5" aria-label="Loading contents">
              <Skeleton className="mb-1 h-3 w-24" />
              {[80, 65, 90, 55, 70, 85].map((w, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
              ))}
            </div>
          )
        )}
      </div>
      <div className="grid shrink-0 gap-1 border-t px-2.5 py-3">
        <Link
          to={`/${bookSlug}/glossary`}
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        >
          <BookText className="size-4 text-muted-foreground" />
          Abbreviations
        </Link>
        {toc && editor && (
          <button
            type="button"
            onClick={onCreate}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] text-primary transition-colors hover:bg-primary-soft"
          >
            <Plus className="size-4" />
            New chapter
          </button>
        )}
      </div>
    </div>
  );
}

export default function Layout() {
  const { bookSlug } = useParams();
  const { editor, user } = useAccount();
  async function refresh() {
    const [d, t] = await Promise.all([api.books(), api.toc(bookSlug)]);
    setBook(d.books.find((b) => b.slug === bookSlug));
    setToc(t);
  }
  const navigate = useNavigate();
  const location = useLocation();
  const [book, setBook] = useState(null);
  const [toc, setToc] = useState(null);
  const [error, setError] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [creating, setCreating] = useState(null); // null | { type: "chapter" } | { type: "section", chapterId, parentId }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const widthRef = useRef(sidebarWidth);
  const draggingRef = useRef(false);

  useEffect(() => {
    setBook(null);
    setToc(null);
    setError(null);
    Promise.all([
      api.books().then((d) => d.books.find((b) => b.slug === bookSlug)),
      api.toc(bookSlug),
    ])
      .then(([book, toc]) => {
        setBook(book);
        setToc(toc);
      })
      .catch((err) => setError(err.message));
  }, [bookSlug, user]);

  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (book) document.title = `${book.title} · Loony Library`;
    return () => {
      document.title = "Loony Library";
    };
  }, [book]);

  async function handleCreate({ title, number }) {
    let sectionId;
    if (creating.type === "chapter") {
      const { section } = await api.createChapter(bookSlug, { title, number });
      sectionId = section.id;
    } else {
      const { section } = await api.createSection({
        chapterId: creating.chapterId,
        parentId: creating.parentId,
        title,
      });
      sectionId = section.id;
    }
    const freshToc = await api.toc(bookSlug);
    setToc(freshToc);
    setCreating(null);
    navigate(`/${bookSlug}/sections/${sectionId}`, {
      state: { autoEdit: true },
    });
  }

  // After a delete, the section currently being viewed may no longer exist -
  // either it was the thing deleted, or it was nested under it - so leave
  // for the book's home page whenever that's the case.
  async function refreshTocAndLeaveIfViewingGone(freshToc) {
    setToc(freshToc);
    const viewedId = location.pathname.match(/\/sections\/([^/]+)$/)?.[1];
    if (viewedId && !collectSectionIds(freshToc.chapters).has(viewedId)) {
      navigate(`/${bookSlug}`, { replace: true });
    }
  }

  async function handleDeleteChapter(chapterId, title) {
    if (
      !window.confirm(
        `Delete chapter "${title}"? This deletes everything inside it and can't be undone.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteChapter(chapterId);
      await refreshTocAndLeaveIfViewingGone(await api.toc(bookSlug));
    } catch (err) {
      window.alert(`Couldn't delete "${title}": ${err.message}`);
    }
  }

  async function handleDeleteSection(sectionId, title) {
    if (
      !window.confirm(
        `Delete "${title}"? This deletes everything inside it and can't be undone.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteSection(sectionId);
      await refreshTocAndLeaveIfViewingGone(await api.toc(bookSlug));
    } catch (err) {
      window.alert(`Couldn't delete "${title}": ${err.message}`);
    }
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (!draggingRef.current) return;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, e.clientX),
      );
      widthRef.current = next;
      setSidebarWidth(next);
    }
    function stopDragging() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("resizing-sidebar");
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
      } catch {
        // ignore - nothing we can do if storage is unavailable
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDragging);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  function startResize() {
    draggingRef.current = true;
    document.body.classList.add("resizing-sidebar");
  }

  const sidebarProps = {
    book,
    bookSlug,
    toc,
    error,
    editor,
    onCreate: () => setCreating({ type: "chapter" }),
    tocHandlers: {
      onAddSection: (chapterId) =>
        setCreating({ type: "section", chapterId, parentId: null }),
      onAddSubsection: (chapterId, parentId) =>
        setCreating({ type: "section", chapterId, parentId }),
      onDeleteChapter: handleDeleteChapter,
      onDeleteSection: handleDeleteSection,
    },
  };

  return (
    <div className="min-h-dvh lg:flex">
      <a
        className="fixed left-4 top-[-100px] z-[100] rounded-md bg-card px-4 py-2 text-sm font-medium shadow-md focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <aside
        className="no-print sticky top-0 hidden h-dvh shrink-0 border-r bg-muted/50 lg:block"
        style={{ width: sidebarWidth }}
      >
        <BookSidebar {...sidebarProps} />
      </aside>
      <div
        className="no-print group relative z-10 -ml-[3px] hidden w-[6px] shrink-0 cursor-col-resize outline-none lg:block"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation"
        tabIndex={0}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            const w = Math.max(
              MIN_SIDEBAR_WIDTH,
              Math.min(
                MAX_SIDEBAR_WIDTH,
                sidebarWidth + (e.key === "ArrowRight" ? 20 : -20),
              ),
            );
            setSidebarWidth(w);
            widthRef.current = w;
            try {
              localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
            } catch {}
          }
        }}
      >
        <span className="absolute inset-y-0 left-[2px] w-[2px] rounded-full bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary [body.resizing-sidebar_&]:bg-primary" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md backdrop-saturate-150">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open contents"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu />
            </Button>
            <p className="min-w-0 flex-1 truncate font-serif text-[16px] font-medium lg:text-[15px] lg:font-normal lg:text-muted-foreground">
              {book?.title}
            </p>
            <div className="flex items-center gap-1">
              {editor && toc && (
                <Tooltip content="Edit & reorder contents">
                  <Button variant="ghost" size="sm" onClick={() => setOutlineOpen(true)} className="text-muted-foreground hover:text-foreground">
                    <ListTree />
                    <span className="hidden sm:inline">Outline</span>
                  </Button>
                </Tooltip>
              )}
              {book && (
                <Tooltip content="Details, shelves & export">
                  <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(true)} className="text-muted-foreground hover:text-foreground">
                    <Info />
                    <span className="hidden sm:inline">About</span>
                  </Button>
                </Tooltip>
              )}
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <ReadingSettings />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main
          className="flex-1 px-5 pb-24 pt-10 outline-none sm:px-8 lg:pt-14"
          id="main-content"
          tabIndex={-1}
        >
          <div className="mx-auto w-full max-w-[44rem]">
            <Outlet context={{ toc, refresh }} />
          </div>
        </main>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="bg-background p-0">
          <SheetTitle className="sr-only">Contents</SheetTitle>
          <SheetDescription className="sr-only">Book navigation</SheetDescription>
          <BookSidebar {...sidebarProps} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>
      {book && (
        <BookDetails book={book} refresh={refresh} open={detailsOpen} onOpenChange={setDetailsOpen} />
      )}
      {editor && toc && (
        <OutlineEditor toc={toc} refresh={refresh} open={outlineOpen} onOpenChange={setOutlineOpen} />
      )}
      {creating && (
        <NewItemDialog
          heading={creating.type === "chapter" ? "New chapter" : "New section"}
          extraField={
            creating.type === "chapter"
              ? { key: "number", label: "Number" }
              : undefined
          }
          onCreate={handleCreate}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}
