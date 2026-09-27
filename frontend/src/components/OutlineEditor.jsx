import { useState } from "react";
import { api } from "../api";
export default function OutlineEditor({ toc, refresh }) {
  const [error, setError] = useState(""),
    [drag, setDrag] = useState(null);
  async function move(kind, nodes, from, to) {
    if (to < 0 || to >= nodes.length || from === to) return;
    try {
      const ids = nodes.map((n) => n.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await api.put("/api/reorder", { kind, ids });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  function list(nodes, kind) {
    return (
      <ol>
        {nodes.map((n, i) => (
          <li
            key={n.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDrag({
                kind,
                ids: nodes.map((x) => x.id).join(","),
                index: i,
              });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (
                drag?.kind === kind &&
                drag.ids === nodes.map((x) => x.id).join(",")
              )
                move(kind, nodes, drag.index, i);
              setDrag(null);
            }}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  await api.patch(`/api/${kind}/${n.id}`, f);
                  await refresh();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <label>
                Title
                <input
                  name="title"
                  required
                  defaultValue={n.title}
                  key={n.title}
                />
              </label>
              {kind === "chapters" && (
                <label>
                  Number
                  <input name="number" defaultValue={n.number || ""} />
                </label>
              )}
              <button>Rename</button>
              <button
                type="button"
                aria-label={`Move ${n.title} up`}
                disabled={i === 0}
                onClick={() => move(kind, nodes, i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${n.title} down`}
                disabled={i === nodes.length - 1}
                onClick={() => move(kind, nodes, i, i + 1)}
              >
                ↓
              </button>
            </form>
            {list(n.sections || n.children || [], "sections")}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <details className="panel no-print">
      <summary>Edit & reorder contents</summary>
      <p>Drag siblings to reorder, or use the arrow buttons.</p>
      {error && <p role="alert">{error}</p>}
      {list(toc.chapters, "chapters")}
    </details>
  );
}
