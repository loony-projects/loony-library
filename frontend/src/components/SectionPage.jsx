import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { api } from "../api";
import { blocksToMarkdown } from "../markdown";
import Block from "./Blocks";
import MarkdownEditor from "./MarkdownEditor";

export default function SectionPage() {
  const { id, bookSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api.section(id).then(setData).catch((err) => setError(err.message));

    // A section just created via the sidebar's "+" arrives here with
    // autoEdit so it opens straight into the editor instead of showing an
    // empty page first; consumed once so back/forward don't reopen it.
    if (location.state?.autoEdit) {
      setEditing(true);
      navigate(location.pathname, { replace: true, state: null });
    } else {
      setEditing(false);
    }
  }, [id]);

  if (error) return <p className="error">Couldn't load this section: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  const { section, breadcrumbs, children, blocks } = data;

  async function handleSave(markdown) {
    const { blocks: newBlocks } = await api.updateSection(id, markdown);
    setData({ ...data, blocks: newBlocks });
    setEditing(false);
  }

  return (
    <article className="section-page">
      <nav className="breadcrumbs">
        {breadcrumbs.map((b, i) => (
          <span key={b.id}>
            {i > 0 && <span className="crumb-sep"> / </span>}
            <Link to={`/${bookSlug}/sections/${b.id}`}>{b.numbering ? `${b.numbering} ${b.title}` : b.title}</Link>
          </span>
        ))}
      </nav>

      <div className="section-heading-row">
        <h1>
          {section.numbering && <span className="section-numbering">{section.numbering}</span>}
          {section.title}
        </h1>
        {!editing && (
          <button type="button" className="section-edit-button" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <MarkdownEditor
          title={section.numbering ? `${section.numbering} ${section.title}` : section.title}
          initialValue={blocksToMarkdown(blocks)}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="section-content">
          {blocks.length === 0 && <p className="empty">No content in this section.</p>}
          {blocks.map((block) => (
            <Block key={block.id} block={block} />
          ))}
        </div>
      )}

      {children.length > 0 && (
        <nav className="section-children">
          <h2>In this section</h2>
          <ul>
            {children.map((c) => (
              <li key={c.id}>
                <Link to={`/${bookSlug}/sections/${c.id}`}>
                  {c.numbering ? `${c.numbering} ${c.title}` : c.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
