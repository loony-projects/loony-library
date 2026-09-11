import { NavLink, useParams } from "react-router-dom";

function TocSection({ section, bookSlug }) {
  return (
    <li>
      <NavLink
        to={`/${bookSlug}/sections/${section.id}`}
        className={({ isActive }) => (isActive ? "toc-link toc-link--active" : "toc-link")}
      >
        {section.numbering && <span className="toc-numbering">{section.numbering}</span>}
        <span>{section.title}</span>
      </NavLink>
      {section.children.length > 0 && (
        <ul>
          {section.children.map((child) => (
            <TocSection key={child.id} section={child} bookSlug={bookSlug} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TocTree({ chapters }) {
  const { bookSlug } = useParams();
  return (
    <nav className="toc">
      {chapters.map((chapter) => (
        <div key={chapter.id} className="toc-chapter">
          <div className="toc-chapter-title">
            {chapter.number && <span className="toc-numbering">{chapter.number}.</span>}
            {chapter.title}
          </div>
          <ul>
            {chapter.sections.map((section) => (
              <TocSection key={section.id} section={section} bookSlug={bookSlug} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
