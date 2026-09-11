import { useCallback, useRef, useState } from "react";
import { Loader2, Plus, Upload, X } from "lucide-react";

const METADATA_FIELDS = [
  { key: "author", label: "Author" },
  { key: "publisher", label: "Publisher" },
  { key: "isbn", label: "ISBN" },
  { key: "edition", label: "Edition" },
  { key: "published_year", label: "Published year" },
  { key: "price", label: "Price" },
];

// Client-side preview only - the backend derives and uniquifies the real
// slug itself (see backend/src/routes/book.js), so this can drift from the
// final URL if the title collides with an existing book.
function slugPreview(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A two-step "new book" flow: book details + cover art, then an optional
 * batch of opening chapter titles - so a book lands with real structure
 * instead of an empty shell you have to build up one "+" click at a time
 * afterward. onFinish receives everything at once and is responsible for
 * actually creating the book and its chapters (see Library.jsx).
 */
export default function BookWizard({ onFinish, onCancel }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState({});
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [chapterInput, setChapterInput] = useState("");
  const [chapters, setChapters] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const dirty = title.trim().length > 0 || chapters.length > 0;

  function setField(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleCoverChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  function addChapter() {
    const t = chapterInput.trim();
    if (!t) return;
    setChapters((c) => [...c, t]);
    setChapterInput("");
  }

  function removeChapter(index) {
    setChapters((c) => c.filter((_, i) => i !== index));
  }

  const requestCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard this new book?")) return;
    onCancel();
  }, [dirty, onCancel]);

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await onFinish({ title: title.trim(), ...fields, coverFile, chapters });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestCancel()}>
      <div
        className="wizard"
        onKeyDown={(e) => e.key === "Escape" && requestCancel()}
      >
        <div className="wizard-header">
          <h2 className="dialog-heading">New book</h2>
          <div className="wizard-steps">
            <span className={`wizard-step${step === 1 ? " active" : ""}`}>1. Details</span>
            <span className={`wizard-step${step === 2 ? " active" : ""}`}>2. Chapters</span>
          </div>
        </div>

        {step === 1 && (
          <div className="wizard-body">
            <div className="wizard-cover-upload" onClick={() => fileInputRef.current?.click()}>
              {coverPreview ? (
                <img src={coverPreview} alt="Cover preview" />
              ) : (
                <>
                  <Upload size={20} />
                  <span>Drop cover image or click to upload</span>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleCoverChange} />
            </div>

            <label className="dialog-label">
              Title *
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
            </label>

            <div className="wizard-field-grid">
              {METADATA_FIELDS.map((f) => (
                <label className="dialog-label" key={f.key}>
                  {f.label}
                  <input type="text" value={fields[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)} />
                </label>
              ))}
            </div>

            {title.trim() && <p className="wizard-slug-preview">URL: /{slugPreview(title)}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body">
            <p className="wizard-hint">Add your first chapter titles now, or skip and add them later.</p>
            <div className="wizard-chapter-input">
              <input
                type="text"
                placeholder="Chapter title…"
                value={chapterInput}
                onChange={(e) => setChapterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addChapter();
                  }
                }}
                autoFocus
              />
              <button type="button" onClick={addChapter} disabled={!chapterInput.trim()}>
                <Plus size={16} />
              </button>
            </div>
            {chapters.length > 0 && (
              <ul className="wizard-chapter-list">
                {chapters.map((c, i) => (
                  <li key={i}>
                    <span>
                      {i + 1}. {c}
                    </span>
                    <button type="button" onClick={() => removeChapter(i)}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          {step === 1 && (
            <>
              <button type="button" className="dialog-cancel" onClick={requestCancel}>
                Cancel
              </button>
              <button type="button" className="dialog-submit" disabled={!title.trim()} onClick={() => setStep(2)}>
                Next
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" className="dialog-cancel" onClick={() => setStep(1)} disabled={saving}>
                Back
              </button>
              <button type="button" className="dialog-submit" onClick={finish} disabled={saving}>
                {saving && <Loader2 size={14} className="md-spin" />}
                {saving ? "Creating…" : `Create book${chapters.length ? ` (${chapters.length} chapters)` : ""}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
