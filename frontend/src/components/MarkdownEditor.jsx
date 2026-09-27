import { useDialog } from "./useDialog";
import { api } from "../api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { highlightCode } from "../highlight";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  Quote,
  List,
  ListOrdered,
  Link2,
  Image,
  SquareCode,
  Minus,
  Eye,
  EyeOff,
  X,
  Loader2,
  ImageUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Wraps or prefixes the current selection in a textarea with markdown
// syntax, keeping the selection intact so the toolbar/shortcuts feel like a
// normal rich-text editor instead of blindly inserting at the cursor.
function applyWrap(text, selectionStart, selectionEnd, before, after = before) {
  const selected = text.slice(selectionStart, selectionEnd);
  const next =
    text.slice(0, selectionStart) +
    before +
    selected +
    after +
    text.slice(selectionEnd);
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
  return {
    text: next,
    selectionStart: selectionStart + shift,
    selectionEnd: selectionEnd + shift,
  };
}

function applyInsertion(text, selectionStart, selectionEnd, insertion) {
  const next =
    text.slice(0, selectionStart) + insertion + text.slice(selectionEnd);
  const cursor = selectionStart + insertion.length;
  return { text: next, selectionStart: cursor, selectionEnd: cursor };
}

// Grouped for the toolbar, with a visual separator between groups.
const TOOLBAR_GROUPS = [
  [
    {
      icon: Bold,
      title: "Bold (Ctrl+B)",
      action: (t, s, e) => applyWrap(t, s, e, "**"),
    },
    {
      icon: Italic,
      title: "Italic (Ctrl+I)",
      action: (t, s, e) => applyWrap(t, s, e, "*"),
    },
    {
      icon: Strikethrough,
      title: "Strikethrough",
      action: (t, s, e) => applyWrap(t, s, e, "~~"),
    },
    {
      icon: Code,
      title: "Inline code",
      action: (t, s, e) => applyWrap(t, s, e, "`"),
    },
  ],
  [
    {
      icon: Heading2,
      title: "Heading",
      action: (t, s, e) => applyLinePrefix(t, s, e, "## "),
    },
    {
      icon: Quote,
      title: "Quote",
      action: (t, s, e) => applyLinePrefix(t, s, e, "> "),
    },
  ],
  [
    {
      icon: List,
      title: "Bullet list",
      action: (t, s, e) => applyLinePrefix(t, s, e, "- "),
    },
    {
      icon: ListOrdered,
      title: "Numbered list",
      action: (t, s, e) => applyLinePrefix(t, s, e, "1. "),
    },
  ],
  [
    {
      icon: Link2,
      title: "Link",
      action: (t, s, e) => applyWrap(t, s, e, "[", "](url)"),
    },
    {
      icon: Image,
      title: "Image",
      action: (t, s, e) => applyWrap(t, s, e, "![", "](url)"),
    },
    {
      icon: SquareCode,
      title: "Code block",
      action: (t, s, e) => applyWrap(t, s, e, "```\n", "\n```"),
    },
    {
      icon: Minus,
      title: "Horizontal rule",
      action: (t, s, e) => applyInsertion(t, s, e, "\n\n---\n\n"),
    },
  ],
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
 *
 * Save persists but never closes the editor - "dirty" is tracked against
 * the last *saved* text, not the original initialValue, so Save correctly
 * disables itself again right after saving instead of staying enabled
 * forever. Closing (X / Esc) is the only way to leave, and only confirms
 * when there's something newer than the last save to lose.
 */
export default function MarkdownEditor({
  title,
  initialValue,
  onSave,
  onCancel,
}) {
  const [text, setText] = useState(initialValue);
  const [savedText, setSavedText] = useState(initialValue);
  const [hasSavedOnce, setHasSavedOnce] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const dirty = text !== savedText;

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

  const dialogRef = useDialog(requestCancel);

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
    [text],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      setSavedText(text);
      setHasSavedOnce(true);
    } catch (err) {
      setError(err.message);
    } finally {
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
      }
    },
    [handleSave, runToolbarAction],
  );

  const previewHtml = useMemo(
    () =>
      showPreview
        ? DOMPurify.sanitize(
            previewMarked.parse(
              text.replace(
                /!\[([^\]]*)\]\(([^)]+)\)/g,
                (_, alt, src) =>
                  `![${alt}](${/^https?:/.test(src) ? src : api.imageUrl(src)})`,
              ),
            ),
          )
        : null,
    [showPreview, text],
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex h-dvh flex-col bg-background animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${title}`}
      onKeyDown={handleKeyDown}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-3 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Close (Esc)"
          aria-label="Close editor"
          onClick={requestCancel}
        >
          <X />
        </Button>
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate font-serif text-lg font-medium leading-tight">{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                dirty ? "bg-warning" : hasSavedOnce ? "bg-success" : "bg-border",
              )}
            />
            {dirty ? "Unsaved changes" : hasSavedOnce ? "Saved" : "No changes"}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{wordCount(text)} words</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error && (
            <span role="alert" className="max-w-56 truncate text-[13px] text-destructive">
              {error}
            </span>
          )}
          <Button
            type="button"
            variant={showPreview ? "soft" : "outline"}
            size="sm"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff /> : <Eye />}
            Preview
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving && <Loader2 className="animate-spin" />}
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/50 px-3 py-1.5 scrollbar-none sm:px-5">
        {TOOLBAR_GROUPS.map((group, i) => (
          <div
            className="flex items-center gap-0.5 border-r pr-1 last:border-r-0"
            key={i}
          >
            {group.map((btn) => (
              <button
                key={btn.title}
                type="button"
                title={btn.title}
                aria-label={btn.title}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring outline-none"
                onClick={() => runToolbarAction(btn.action)}
              >
                <btn.icon size={16} />
              </button>
            ))}
          </div>
        ))}
        <label className="ml-1 flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-within:ring-[3px] focus-within:ring-ring">
          <ImageUp size={16} />
          Upload image
          <input
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const form = new FormData();
              form.append("image", file);
              try {
                const d = await api.postForm("/api/images", form);
                runToolbarAction((t, s, en) =>
                  applyInsertion(t, s, en, `![Image description](${d.path})`),
                );
              } catch (e) {
                setError(e.message);
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1",
          showPreview && "flex-col md:flex-row",
        )}
      >
        <textarea
          aria-label="Section Markdown"
          ref={textareaRef}
          className={cn(
            "h-full min-w-0 flex-1 resize-none bg-background font-mono text-[15px] leading-[1.8] text-foreground outline-none",
            showPreview
              ? "border-b px-5 py-6 md:border-b-0 md:border-r md:px-8"
              : "px-[max(1.25rem,calc((100%-46rem)/2))] py-10",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck="false"
        />
        {showPreview && (
          <div
            className="reading h-full min-w-0 flex-1 overflow-y-auto bg-card px-5 py-6 md:px-10 md:py-10"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>
    </div>
  );
}
