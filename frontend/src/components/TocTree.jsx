import { NavLink, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

function TocSection({ section, bookSlug, onAddSubsection, onDeleteSection }) {
  return (
    <li>
      <div className="toc-row">
        <NavLink
          to={`/${bookSlug}/sections/${section.id}`}
          className={({ isActive }) => (isActive ? "toc-link toc-link--active" : "toc-link")}
        >
          {section.numbering && <span className="toc-numbering">{section.numbering}</span>}
          <span>{section.title}</span>
        </NavLink>
        <div className="toc-row-actions">
          <button
            type="button"
            className="toc-add-button"
            title="Add subsection"
            onClick={() => onAddSubsection(section.chapter_id, section.id)}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="toc-delete-button"
            title="Delete section"
            onClick={() => onDeleteSection(section.id, section.title)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {section.children.length > 0 && (
        <ul>
          {section.children.map((child) => (
            <TocSection
              key={child.id}
              section={child}
              bookSlug={bookSlug}
              onAddSubsection={onAddSubsection}
              onDeleteSection={onDeleteSection}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TocTree({ chapters, onAddSection, onAddSubsection, onDeleteChapter, onDeleteSection }) {
  const { bookSlug } = useParams();
  return (
    <nav className="toc">
      {chapters.map((chapter) => (
        <div key={chapter.id} className="toc-chapter">
          <div className="toc-row">
            <div className="toc-chapter-title">
              {chapter.number && <span className="toc-numbering">{chapter.number}.</span>}
              {chapter.title}
            </div>
            <div className="toc-row-actions">
              <button
                type="button"
                className="toc-add-button"
                title="Add section"
                onClick={() => onAddSection(chapter.id)}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                className="toc-delete-button"
                title="Delete chapter"
                onClick={() => onDeleteChapter(chapter.id, chapter.title)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <ul>
            {chapter.sections.map((section) => (
              <TocSection
                key={section.id}
                section={section}
                bookSlug={bookSlug}
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
