import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../api";
import TocTree from "./TocTree";
import SearchBox from "./SearchBox";
import NewItemDialog from "./NewItemDialog";

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 640;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_WIDTH_KEY = "loony-library-sidebar-width";

function readStoredWidth() {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH) return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) - fall through to default
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

export default function Layout() {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [toc, setToc] = useState(null);
  const [error, setError] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [creating, setCreating] = useState(null); // null | { type: "chapter" } | { type: "section", chapterId, parentId }
  const widthRef = useRef(sidebarWidth);
  const draggingRef = useRef(false);

  useEffect(() => {
    setBook(null);
    setToc(null);
    setError(null);
    Promise.all([api.book(bookSlug), api.toc(bookSlug)])
      .then(([book, toc]) => {
        setBook(book);
        setToc(toc);
      })
      .catch((err) => setError(err.message));
  }, [bookSlug]);

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
    navigate(`/${bookSlug}/sections/${sectionId}`, { state: { autoEdit: true } });
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
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

  return (
    <div className="layout">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <Link to="/" className="library-link">
            ← Library
          </Link>
          <Link to={`/${bookSlug}`} className="book-title">
            {book ? book.title : "Loading…"}
          </Link>
          <Link to={`/${bookSlug}/glossary`} className="glossary-link">
            Abbreviations
          </Link>
        </div>
        <SearchBox />
        {error && <p className="error">Couldn't load the table of contents: {error}</p>}
        {toc && (
          <TocTree
            chapters={toc.chapters}
            onAddSection={(chapterId) => setCreating({ type: "section", chapterId, parentId: null })}
            onAddSubsection={(chapterId, parentId) => setCreating({ type: "section", chapterId, parentId })}
          />
        )}
        {!toc && !error && <p className="loading">Loading contents…</p>}
        {toc && (
          <button type="button" className="add-chapter-button" onClick={() => setCreating({ type: "chapter" })}>
            <Plus size={14} />
            New chapter
          </button>
        )}
      </aside>
      <div
        className="sidebar-resizer"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation"
      />
      <main className="content">
        <Outlet />
      </main>
      {creating && (
        <NewItemDialog
          heading={creating.type === "chapter" ? "New chapter" : "New section"}
          showNumber={creating.type === "chapter"}
          onCreate={handleCreate}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}
