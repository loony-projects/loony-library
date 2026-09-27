import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "./Account";
export function Preferences() {
  const [settings, setSettings] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("reading-settings")) || {
          dark: false,
          size: 18,
          spacing: 1.7,
        }
      );
    } catch {
      return { dark: false, size: 18, spacing: 1.7 };
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = settings.dark ? "dark" : "light";
    document.documentElement.style.setProperty(
      "--reading-size",
      `${settings.size}px`,
    );
    document.documentElement.style.setProperty(
      "--reading-spacing",
      settings.spacing,
    );
    try {
      localStorage.setItem("reading-settings", JSON.stringify(settings));
    } catch {}
  }, [settings]);
  return (
    <details className="no-print preferences">
      <summary>Reading appearance</summary>
      <label>
        <input
          type="checkbox"
          checked={settings.dark}
          onChange={(e) => setSettings({ ...settings, dark: e.target.checked })}
        />
        Dark mode
      </label>
      <label>
        Font size
        <input
          type="range"
          min="14"
          max="28"
          value={settings.size}
          onChange={(e) =>
            setSettings({ ...settings, size: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Line spacing
        <input
          type="range"
          min="1.2"
          max="2.4"
          step="0.1"
          value={settings.spacing}
          onChange={(e) =>
            setSettings({ ...settings, spacing: Number(e.target.value) })
          }
        />
      </label>
    </details>
  );
}
export function PersonalLibrary() {
  const { user } = useAccount();
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api
        .get("/api/me")
        .then(setData)
        .catch((e) => setError(e.message));
    else setData(null);
  }, [user]);
  if (!user) return null;
  return (
    <section className="panel">
      <h2>Your library</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <h3>Continue reading</h3>
          {data.reading.length === 0 && (
            <p>Open a section to start your reading history.</p>
          )}
          {data.reading.map((x) => (
            <p key={x.book_id}>
              <Link to={`/${x.slug}/sections/${x.section_id}`}>
                {x.title} — {x.section_title}
              </Link>
            </p>
          ))}
          <h3>Favorites & wishlist</h3>
          {data.shelves
            .filter((x) => x.favorite || x.wishlist)
            .map((x) => (
              <p key={x.book_id}>
                <Link to={`/${x.slug}`}>{x.title}</Link> ·{" "}
                {x.favorite ? "Favorite " : ""}
                {x.wishlist ? "Wishlist" : ""}
              </p>
            ))}
          <details>
            <summary>Bookmarks, highlights & notes</summary>
            {data.annotations.map((x) => (
              <p key={x.id}>
                <Link to={`/${x.slug}/sections/${x.section_id}`}>
                  {x.book_title}
                </Link>{" "}
                · {x.kind}: {x.quote} {x.note}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
export function Annotations({ id }) {
  const { user } = useAccount();
  const [items, setItems] = useState([]),
    [quote, setQuote] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      api
        .get("/api/me")
        .then((d) =>
          setItems(d.annotations.filter((x) => x.section_id === id)),
        ),
    [id],
  );
  useEffect(() => {
    setQuote("");
    setNote("");
    if (user) {
      refresh().catch((e) => setError(e.message));
      api
        .put("/api/me/progress", { section_id: id })
        .catch((e) => setError(e.message));
    }
  }, [id, user, refresh]);
  useEffect(() => {
    if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
    const root = document.querySelector(".section-content");
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    let text = "",
      node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    const ranges = [];
    for (const item of items.filter((i) => i.kind === "highlight" && i.quote)) {
      const start = text.indexOf(item.quote);
      if (start < 0) continue;
      const end = start + item.quote.length;
      const first = nodes.find((n) => n.start + n.node.length > start),
        last = nodes.find((n) => n.start + n.node.length >= end);
      if (first && last) {
        const range = new Range();
        range.setStart(first.node, start - first.start);
        range.setEnd(last.node, end - last.start);
        ranges.push(range);
      }
    }
    CSS.highlights.set("saved-notes", new Highlight(...ranges));
    return () => CSS.highlights.delete("saved-notes");
  });
  async function save(kind) {
    try {
      await api.post("/api/me/annotations", {
        section_id: id,
        kind,
        quote,
        note,
      });
      setQuote("");
      setNote("");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  if (!user) return null;
  return (
    <details className="panel no-print">
      <summary>Bookmarks, highlights & notes ({items.length})</summary>
      <button onClick={() => save("bookmark")}>Bookmark section</button>
      <button onClick={() => setQuote(window.getSelection()?.toString() || "")}>
        Capture selected text
      </button>
      <label>
        Highlighted text
        <textarea value={quote} onChange={(e) => setQuote(e.target.value)} />
      </label>
      <label>
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button disabled={!quote} onClick={() => save("highlight")}>
        Save highlight
      </button>
      <button disabled={!note} onClick={() => save("note")}>
        Save note
      </button>
      {error && <p role="alert">{error}</p>}
      {items.map((x) => (
        <div key={x.id}>
          <strong>{x.kind}</strong>
          <blockquote>{x.quote}</blockquote>
          <p>{x.note}</p>
          <button
            onClick={async () => {
              try {
                await api.del(`/api/me/annotations/${x.id}`);
                await refresh();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Remove {x.kind}
          </button>
        </div>
      ))}
    </details>
  );
}
export function SectionNavigation({ id, slug, toc }) {
  const sections = [];
  function walk(nodes) {
    for (const n of nodes) {
      sections.push(n);
      walk(n.children);
    }
  }
  for (const c of toc?.chapters || []) walk(c.sections);
  const i = sections.findIndex((s) => s.id === id);
  return (
    <nav
      className="section-navigation no-print"
      aria-label="Sequential reading"
    >
      {i > 0 ? (
        <Link to={`/${slug}/sections/${sections[i - 1].id}`}>
          ← {sections[i - 1].title}
        </Link>
      ) : (
        <span />
      )}
      {i >= 0 && i < sections.length - 1 && (
        <Link to={`/${slug}/sections/${sections[i + 1].id}`}>
          {sections[i + 1].title} →
        </Link>
      )}
    </nav>
  );
}
