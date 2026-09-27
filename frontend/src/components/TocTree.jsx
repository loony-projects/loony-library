import { NavLink, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
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

export default function TocTree({
  chapters,
  onAddSection,
  onAddSubsection,
  onDeleteChapter,
  onDeleteSection,
}) {
  const { bookSlug } = useParams();
  const { editor } = useAccount();
  if (chapters.length === 0)
    return <p className="px-2.5 py-4 text-sm text-muted-foreground">No chapters yet.</p>;
  return (
    <nav aria-label="Table of contents" className="grid gap-6">
      {chapters.map((chapter) => (
        <div key={chapter.id}>
          <div className="group/row mb-1 flex items-center gap-1 px-2.5">
            <h3 className="flex min-w-0 flex-1 gap-2 text-[12px] font-semibold uppercase leading-snug tracking-[0.06em] text-muted-foreground">
              {chapter.number && <span className="tabular-nums">{chapter.number}</span>}
              <span className="min-w-0">{chapter.title}</span>
            </h3>
            {editor && (
              <RowActions
                addLabel="Add section"
                deleteLabel="Delete chapter"
                onAdd={() => onAddSection(chapter.id)}
                onDelete={() => onDeleteChapter(chapter.id, chapter.title)}
              />
            )}
          </div>
          <ul className="grid gap-0.5">
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
        </div>
      ))}
    </nav>
  );
}
