import { useCallback, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Wraps or prefixes the current selection in a textarea with markdown
// syntax, keeping the selection intact so the toolbar/shortcuts feel like a
// normal rich-text editor instead of blindly inserting at the cursor.
function applyWrap(text, selectionStart, selectionEnd, before, after = before) {
  const selected = text.slice(selectionStart, selectionEnd);
  const next = text.slice(0, selectionStart) + before + selected + after + text.slice(selectionEnd);
  return {
    text: next,
    selectionStart: selectionStart + before.length,
    selectionEnd: selectionStart + before.length + selected.length,
  };
}

function applyLinePrefix(text, selectionStart, selectionEnd, prefix) {
  const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
  const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  const shift = prefix.length;
  return { text: next, selectionStart: selectionStart + shift, selectionEnd: selectionEnd + shift };
}

const TOOLBAR = [
  { label: "B", title: "Bold (Ctrl+B)", className: "md-toolbar-bold", action: (t, s, e) => applyWrap(t, s, e, "**") },
  { label: "I", title: "Italic (Ctrl+I)", className: "md-toolbar-italic", action: (t, s, e) => applyWrap(t, s, e, "*") },
  { label: "H", title: "Heading", action: (t, s, e) => applyLinePrefix(t, s, e, "## ") },
  { label: "❝", title: "Quote", action: (t, s, e) => applyLinePrefix(t, s, e, "> ") },
  { label: "•", title: "Bullet list", action: (t, s, e) => applyLinePrefix(t, s, e, "- ") },
  { label: "1.", title: "Numbered list", action: (t, s, e) => applyLinePrefix(t, s, e, "1. ") },
  { label: "🔗", title: "Link", action: (t, s, e) => applyWrap(t, s, e, "[", "](url)") },
];

/**
 * A focused markdown editor: toolbar + textarea + optional live preview,
 * used to edit a section's content in place (see SectionPage.jsx). Saving
 * hands the raw markdown to the backend, which re-parses it into
 * content_blocks (backend/src/parseMarkdown.js) - this component only ever
 * deals in plain text.
 */
export default function MarkdownEditor({ initialValue, onSave, onCancel }) {
  const [text, setText] = useState(initialValue);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const dirty = text !== initialValue;

  const runToolbarAction = useCallback((action) => {
    const el = textareaRef.current;
    if (!el) return;
    const result = action(text, el.selectionStart, el.selectionEnd);
    setText(result.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }, [text]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }, [text, onSave]);

  const handleKeyDown = useCallback(
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (mod && e.key === "b") {
        e.preventDefault();
        runToolbarAction((t, s, en) => applyWrap(t, s, en, "**"));
      } else if (mod && e.key === "i") {
        e.preventDefault();
        runToolbarAction((t, s, en) => applyWrap(t, s, en, "*"));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSave, runToolbarAction, onCancel]
  );

  const previewHtml = showPreview ? DOMPurify.sanitize(marked.parse(text)) : null;

  return (
    <div className="md-editor" onKeyDown={handleKeyDown}>
      <div className="md-editor-toolbar">
        {TOOLBAR.map((btn) => (
          <button
            key={btn.title}
            type="button"
            title={btn.title}
            className={btn.className}
            onClick={() => runToolbarAction(btn.action)}
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          className={`md-toolbar-preview${showPreview ? " active" : ""}`}
          onClick={() => setShowPreview((v) => !v)}
        >
          Preview
        </button>
      </div>

      <div className={`md-editor-body${showPreview ? " md-editor-body--split" : ""}`}>
        <textarea
          ref={textareaRef}
          className="md-editor-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck="false"
        />
        {showPreview && (
          <div className="md-editor-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </div>

      <div className="md-editor-footer">
        {error && <span className="md-editor-error">{error}</span>}
        <span className="md-editor-status">{dirty ? "Unsaved changes" : "No changes"}</span>
        <button type="button" className="md-editor-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="md-editor-save" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
