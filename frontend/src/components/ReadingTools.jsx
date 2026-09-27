import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronDown,
  Highlighter,
  NotebookPen,
  TextSelect,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { useAccount } from "./Account";
import { cn } from "@/lib/utils";
import { InlineMessage } from "./common/States";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

const KIND_ICON = { bookmark: Bookmark, highlight: Highlighter, note: NotebookPen };

export function Annotations({ id }) {
  const { user } = useAccount();
  const [items, setItems] = useState([]),
    [quote, setQuote] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
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
    <section className="no-print mt-16 rounded-xl border bg-card shadow-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
          <NotebookPen className="size-4" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium">Your notes on this section</span>
          <span className="block text-[13px] text-muted-foreground">
            {items.length
              ? `${items.length} saved · private to you`
              : "Bookmarks, highlights and notes · private to you"}
          </span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-5 border-t px-5 pb-5 pt-5 animate-in fade-in-0">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => save("bookmark")}>
              <Bookmark /> Bookmark section
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQuote(window.getSelection()?.toString() || "")}
            >
              <TextSelect /> Capture selected text
            </Button>
          </div>
          <Field label="Highlighted text" htmlFor="annot-quote" hint="Select a passage above, then capture it.">
            <Textarea
              id="annot-quote"
              rows={2}
              className="font-serif italic"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="annot-note">
            <Textarea id="annot-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!quote} onClick={() => save("highlight")}>
              <Highlighter /> Save highlight
            </Button>
            <Button size="sm" variant="secondary" disabled={!note} onClick={() => save("note")}>
              <NotebookPen /> Save note
            </Button>
          </div>
          <InlineMessage tone="error">{error}</InlineMessage>
          {items.length > 0 && (
            <ul className="divide-y border-t">
              {items.map((x) => {
                const Icon = KIND_ICON[x.kind] || NotebookPen;
                return (
                  <li key={x.id} className="group flex gap-3 py-4">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium capitalize text-muted-foreground">{x.kind}</p>
                      {x.quote && (
                        <blockquote className="mt-1 border-l-2 border-primary/40 pl-3 font-serif text-[16px] italic leading-relaxed">
                          {x.quote}
                        </blockquote>
                      )}
                      {x.note && <p className="mt-1.5 text-sm">{x.note}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${x.kind}`}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={async () => {
                        try {
                          await api.del(`/api/me/annotations/${x.id}`);
                          await refresh();
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function NavCard({ to, label, title, next }) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex flex-col gap-1 rounded-lg border p-4 transition-[border-color,box-shadow,background-color] duration-200 outline-none hover:border-input hover:bg-card hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring sm:p-5",
        next && "items-end text-right",
      )}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
        {!next && <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />}
        {label}
        {next && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="line-clamp-2 font-serif text-[17px] font-medium leading-snug group-hover:text-primary">
        {title}
      </span>
    </Link>
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
  const prev = i > 0 && sections[i - 1];
  const next = i >= 0 && i < sections.length - 1 && sections[i + 1];
  if (!prev && !next) return null;
  return (
    <nav
      className="no-print mt-12 grid gap-3 border-t pt-8 sm:grid-cols-2"
      aria-label="Sequential reading"
    >
      {prev ? (
        <NavCard to={`/${slug}/sections/${prev.id}`} label="Previous" title={prev.title} />
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && <NavCard next to={`/${slug}/sections/${next.id}`} label="Next" title={next.title} />}
    </nav>
  );
}
