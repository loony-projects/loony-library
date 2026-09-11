import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { api } from "../api";
import TocTree from "./TocTree";
import SearchBox from "./SearchBox";

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
  const [book, setBook] = useState(null);
  const [toc, setToc] = useState(null);
  const [error, setError] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
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
        {toc && <TocTree chapters={toc.chapters} />}
        {!toc && !error && <p className="loading">Loading contents…</p>}
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
    </div>
  );
}
