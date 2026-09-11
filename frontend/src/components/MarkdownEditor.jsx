import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { highlightCode } from "../highlight";
import {
  Bold,
  Italic,
  Heading2,
  Quote,
  List,
  ListOrdered,
  Link2,
  Eye,
  EyeOff,
  X,
  Loader2,
} from "lucide-react";

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
  { icon: Bold, title: "Bold (Ctrl+B)", action: (t, s, e) => applyWrap(t, s, e, "**") },
  { icon: Italic, title: "Italic (Ctrl+I)", action: (t, s, e) => applyWrap(t, s, e, "*") },
  { icon: Heading2, title: "Heading", action: (t, s, e) => applyLinePrefix(t, s, e, "## ") },
  { icon: Quote, title: "Quote", action: (t, s, e) => applyLinePrefix(t, s, e, "> ") },
  { icon: List, title: "Bullet list", action: (t, s, e) => applyLinePrefix(t, s, e, "- ") },
  { icon: ListOrdered, title: "Numbered list", action: (t, s, e) => applyLinePrefix(t, s, e, "1. ") },
  { icon: Link2, title: "Link", action: (t, s, e) => applyWrap(t, s, e, "[", "](url)") },
];

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// A dedicated instance (rather than the default export) so overriding the
// code renderer here can't affect any other `marked` usage in the app.
const previewMarked = new Marked({
  renderer: {
    code({ text, lang }) {
      const { html, language } = highlightCode(text, lang);
      return `<pre class="block-code"><code class="hljs language-${language}">${html}</code></pre>`;
    },
  },
});

/**
 * A full-screen, distraction-free markdown editor used to edit a section's
 * content in place (see SectionPage.jsx). It takes over the whole viewport
 * rather than living inside the narrow reading column - editing is a
 * focused task, not something squeezed next to a sidebar. Saving hands the
 * raw markdown to the backend, which re-parses it into content_blocks
 * (backend/src/parseMarkdown.js) - this component only ever deals in plain
 * text.
 */
export default function MarkdownEditor({ title, initialValue, onSave, onCancel }) {
  const [text, setText] = useState(initialValue);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const dirty = text !== initialValue;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textareaRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const requestCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onCancel();
  }, [dirty, onCancel]);

  const runToolbarAction = useCallback(
    (action) => {
      const el = textareaRef.current;
      if (!el) return;
      const result = action(text, el.selectionStart, el.selectionEnd);
      setText(result.text);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [text]
  );

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
        requestCancel();
      }
    },
    [handleSave, runToolbarAction, requestCancel]
  );

  const previewHtml = useMemo(
    () => (showPreview ? DOMPurify.sanitize(previewMarked.parse(text)) : null),
    [showPreview, text]
  );

  return (
    <div className="md-editor" onKeyDown={handleKeyDown}>
      <header className="md-editor-header">
        <button type="button" className="md-editor-icon-button" title="Cancel (Esc)" onClick={requestCancel}>
          <X size={18} />
        </button>
        <div className="md-editor-heading">
          <span className="md-editor-title">{title}</span>
          <span className="md-editor-status">
            {dirty ? "Unsaved changes" : "No changes"} · {wordCount(text)} words
          </span>
        </div>
        <div className="md-editor-header-actions">
          {error && <span className="md-editor-error">{error}</span>}
          <button
            type="button"
            className={`md-toolbar-preview${showPreview ? " active" : ""}`}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
            Preview
          </button>
          <button type="button" className="md-editor-save" onClick={handleSave} disabled={saving || !dirty}>
            {saving && <Loader2 size={15} className="md-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="md-editor-toolbar">
        {TOOLBAR.map((btn) => (
          <button
            key={btn.title}
            type="button"
            title={btn.title}
            className="md-editor-icon-button"
            onClick={() => runToolbarAction(btn.action)}
          >
            <btn.icon size={17} />
          </button>
        ))}
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
    </div>
  );
}
