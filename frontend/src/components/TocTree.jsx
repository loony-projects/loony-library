import { useState } from "react";
import { NavLink, useMatch, useParams } from "react-router-dom";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "./Account";

function RowActions({ addLabel, deleteLabel, onAdd, onDelete }) {
  return (
    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
        title={addLabel}
        aria-label={addLabel}
        onClick={onAdd}
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
        title={deleteLabel}
        aria-label={deleteLabel}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function TocSection({ section, bookSlug, editor, onAddSubsection, onDeleteSection }) {
  return (
    <li>
      <div className="group/row flex items-center gap-1">
        <NavLink
          to={`/${bookSlug}/sections/${section.id}`}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 flex-1 gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] leading-snug transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
              isActive
                ? "bg-primary-soft font-medium text-primary-soft-foreground"
                : "text-foreground/80 hover:bg-accent hover:text-foreground",
            )
          }
        >
          {section.numbering && (
            <span className="shrink-0 tabular-nums text-muted-foreground">{section.numbering}</span>
          )}
          <span className="min-w-0">{section.title}</span>
        </NavLink>
        {editor && (
          <RowActions
            addLabel="Add subsection"
            deleteLabel="Delete section"
            onAdd={() => onAddSubsection(section.chapter_id, section.id)}
            onDelete={() => onDeleteSection(section.id, section.title)}
          />
        )}
      </div>
      {section.children.length > 0 && (
        <ul className="ml-3.5 mt-0.5 grid gap-0.5 border-l pl-2">
          {section.children.map((child) => (
            <TocSection
              key={child.id}
              section={child}
              bookSlug={bookSlug}
              editor={editor}
              onAddSubsection={onAddSubsection}
              onDeleteSection={onDeleteSection}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function containsSection(sections, id) {
  return sections.some((s) => s.id === id || containsSection(s.children, id));
}

// The book's contents: chapters only, each one opening to show its sections
// when clicked. On opening a book every chapter starts collapsed (the one
// being read is highlighted); after that, moving into another chapter -
// next/previous, search, a link - opens that chapter by itself.
export default function TocTree({
  chapters,
  onAddSection,
  onAddSubsection,
  onDeleteChapter,
  onDeleteSection,
}) {
  const { bookSlug } = useParams();
  const { editor } = useAccount();
  const match = useMatch("/:bookSlug/sections/:id");
  const currentChapterId = match
    ? chapters.find((c) => containsSection(c.sections, match.params.id))?.id
    : undefined;

  const [expanded, setExpanded] = useState(() => new Set());
  // Open the current chapter whenever the reader moves into another one
  // (adjusting state during render, not in an effect). `null` = no chapter
  // seen yet: the first one a page lands on - including the redirect from
  // the book's address to its first section - is only highlighted.
  const [openedFor, setOpenedFor] = useState(currentChapterId ?? null);
  if (currentChapterId !== openedFor && !(openedFor === null && currentChapterId === undefined)) {
    setOpenedFor(currentChapterId);
    if (currentChapterId && openedFor !== null && !expanded.has(currentChapterId)) {
      setExpanded(new Set(expanded).add(currentChapterId));
    }
  }

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const open = (id) => setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  if (chapters.length === 0)
    return <p className="px-2.5 py-4 text-sm text-muted-foreground">No chapters yet.</p>;
  return (
    <nav aria-label="Table of contents" className="grid gap-0.5">
      {chapters.map((chapter) => {
        const isOpen = expanded.has(chapter.id);
        const isCurrent = chapter.id === currentChapterId;
        const listId = `toc-chapter-${chapter.id}`;
        return (
          <div key={chapter.id}>
            <div className="group/row flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggle(chapter.id)}
                aria-expanded={isOpen}
                aria-controls={listId}
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1.5 py-2 text-left text-[12px] font-semibold uppercase leading-snug tracking-[0.06em] transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring",
                  isCurrent ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ChevronRight
                  aria-hidden
                  className={cn("mt-px size-3.5 shrink-0 transition-transform duration-150", isOpen && "rotate-90")}
                />
                {chapter.number && <span className="tabular-nums">{chapter.number}</span>}
                <span className="min-w-0">{chapter.title}</span>
              </button>
              {editor && (
                <RowActions
                  addLabel="Add section"
                  deleteLabel="Delete chapter"
                  onAdd={() => {
                    open(chapter.id);
                    onAddSection(chapter.id);
                  }}
                  onDelete={() => onDeleteChapter(chapter.id, chapter.title)}
                />
              )}
            </div>
            {isOpen && (
              <ul id={listId} className="mb-2 ml-3.5 mt-0.5 grid gap-0.5 border-l pl-2">
                {chapter.sections.map((section) => (
                  <TocSection
                    key={section.id}
                    section={section}
                    bookSlug={bookSlug}
                    editor={editor}
                    onAddSubsection={onAddSubsection}
                    onDeleteSection={onDeleteSection}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
