import { useCallback, useRef, useState } from "react";
import { Check, GripVertical, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import BookCover from "./library/BookCover";
import { InlineMessage } from "./common/States";

const METADATA_FIELDS = [
  { key: "author", label: "Author" },
  { key: "publisher", label: "Publisher" },
  { key: "isbn", label: "ISBN" },
  { key: "edition", label: "Edition" },
  { key: "published_year", label: "Published year", inputMode: "numeric" },
  { key: "price", label: "Price", inputMode: "decimal" },
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

function Steps({ step }) {
  return (
    <ol className="flex items-center gap-3 text-[13px]">
      {["Details", "Chapters"].map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 && <span className="h-px w-8 bg-border" />}
            <span className={cn("flex items-center gap-2", active || done ? "text-foreground" : "text-muted-foreground")}>
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-primary-soft text-primary-soft-foreground",
                  !active && !done && "bg-secondary text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : n}
              </span>
              <span className={cn(active && "font-medium")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
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
    if (saving) return;
    if (dirty && !window.confirm("Discard this new book?")) return;
    onCancel();
  }, [dirty, onCancel, saving]);

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

  const previewBook = {
    slug: slugPreview(title) || "new-book",
    title: title.trim() || "Untitled",
    author: fields.author,
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestCancel()}>
      <DialogContent
        className="flex max-h-[min(46rem,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 p-0 sm:p-0"
        onInteractOutside={(e) => dirty && e.preventDefault()}
      >
        <DialogHeader className="border-b px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
          <DialogTitle>New book</DialogTitle>
          <DialogDescription className="sr-only">
            Add details and opening chapters for a new book.
          </DialogDescription>
          <div className="mt-3">
            <Steps step={step} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {step === 1 && (
            <div className="grid gap-8 sm:grid-cols-[9.5rem_1fr]">
              <div className="mx-auto w-36 sm:mx-0 sm:w-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative block w-full rounded-[3px_7px_7px_3px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                  aria-label={coverPreview ? "Change cover image" : "Upload cover image"}
                >
                  {coverPreview ? (
                    <div className="relative aspect-[2/3] overflow-hidden rounded-[3px_7px_7px_3px] shadow-book">
                      <img src={coverPreview} alt="Cover preview" className="size-full object-cover" />
                    </div>
                  ) : (
                    <BookCover book={previewBook} />
                  )}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-[inherit] bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <ImagePlus className="size-5" />
                    {coverPreview ? "Change cover" : "Upload cover"}
                  </span>
                </button>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  PNG, JPEG or WebP
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={handleCoverChange}
                />
              </div>

              <div className="grid content-start gap-5">
                <Field
                  label="Title"
                  htmlFor="wizard-title"
                  hint={title.trim() ? `URL: /${slugPreview(title)}` : undefined}
                >
                  <Input
                    id="wizard-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                    required
                    className="h-11 font-serif text-lg"
                  />
                </Field>
                <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                  {METADATA_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label} htmlFor={`wizard-${f.key}`}>
                      <Input
                        id={`wizard-${f.key}`}
                        inputMode={f.inputMode}
                        value={fields[f.key] || ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              <p className="text-[15px] text-muted-foreground">
                Add your opening chapter titles now, or skip and add them later from the book’s contents.
              </p>
              <div className="flex gap-2">
                <Input
                  aria-label="Chapter title"
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
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={addChapter}
                  disabled={!chapterInput.trim()}
                >
                  <Plus />
                  Add
                </Button>
              </div>
              {chapters.length > 0 ? (
                <ol className="divide-y rounded-lg border">
                  {chapters.map((c, i) => (
                    <li key={i} className="group flex items-center gap-3 px-3 py-2.5 text-sm">
                      <GripVertical className="size-4 text-muted-foreground/50" />
                      <span className="w-6 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{c}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeChapter(i)}
                        aria-label={`Remove ${c}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  No chapters yet
                </p>
              )}
            </div>
          )}
          {error && <InlineMessage tone="error" className="mt-5">{error}</InlineMessage>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-6 py-4 sm:px-8">
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={requestCancel}>
                Cancel
              </Button>
              <Button type="button" disabled={!title.trim()} onClick={() => setStep(2)}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={saving}>
                Back
              </Button>
              <Button type="button" onClick={finish} disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {saving
                  ? "Creating…"
                  : `Create book${chapters.length ? ` · ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}` : ""}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
