import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * A small centered modal for creating a chapter or section - just enough to
 * name and place the new item. Writing its content happens afterward in the
 * full-screen MarkdownEditor (see Layout.jsx), so this dialog stays minimal.
 */
export default function NewItemDialog({ heading, showNumber, onCreate, onCancel }) {
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!title.trim()) return;
      setSaving(true);
      setError(null);
      try {
        await onCreate({ title: title.trim(), number: number.trim() || undefined });
      } catch (err) {
        setError(err.message);
        setSaving(false);
      }
    },
    [title, number, onCreate]
  );

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" onSubmit={submit}>
        <h2 className="dialog-heading">{heading}</h2>
        <label className="dialog-label">
          Title
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onCancel()}
            required
          />
        </label>
        {showNumber && (
          <label className="dialog-label">
            Number <span className="dialog-optional">(optional)</span>
            <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
        )}
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="dialog-cancel" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="dialog-submit" disabled={saving || !title.trim()}>
            {saving && <Loader2 size={14} className="md-spin" />}
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
