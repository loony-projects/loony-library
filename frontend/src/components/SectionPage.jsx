import { useAccount } from "./Account";
import { Annotations, SectionNavigation } from "./ReadingTools";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useOutletContext,
} from "react-router-dom";
import { Pencil } from "lucide-react";
import { api } from "../api";
import { blocksToMarkdown } from "../markdown";
import Block from "./Blocks";
import MarkdownEditor from "./MarkdownEditor";

export default function SectionPage() {
  const { id } = useParams();
  return <SectionContent key={id} />;
}

function SectionContent() {
  const { id, bookSlug } = useParams();
  const { editor } = useAccount();
  const { toc, refresh } = useOutletContext();
  const [editorReady, setEditorReady] = useState(false);
  const [draft, setDraft] = useState(null),
    [revisions, setRevisions] = useState([]),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setDraft(null);
    setRevisions([]);
    if (editor)
      Promise.all([
        api.get(`/api/sections/${id}/editor`),
        api.get(`/api/sections/${id}/revisions`),
      ])
        .then(([d, r]) => {
          setDraft(d.draft_markdown);
          setRevisions(r.revisions);
          setEditorReady(true);
        })
        .catch((e) => setNotice(e.message));
  }, [id, editor]);
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(Boolean(location.state?.autoEdit));

  useEffect(() => {
    setData(null);
    setError(null);
    let active = true;
    api
      .section(id)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    // A section just created via the sidebar's "+" arrives here with
    // autoEdit so it opens straight into the editor instead of showing an
    // empty page first; consumed once so back/forward don't reopen it.
    if (location.state?.autoEdit) {
      setEditing(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state?.autoEdit, location.pathname, navigate]);

  if (error)
    return <p className="error">Couldn't load this section: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  const { section, breadcrumbs, children, blocks } = data;

  // Saving persists but doesn't leave the editor - see MarkdownEditor's own
  // save/close split. Keep data.blocks in sync so the read view is current
  // whenever the user does close it.
  async function handleSave(markdown) {
    await api.put(`/api/sections/${id}/draft`, { markdown });
    setDraft(markdown);
    const history = await api.get(`/api/sections/${id}/revisions`);
    setRevisions(history.revisions);
  }

  return (
    <article className="section-page">
      <nav className="breadcrumbs">
        {breadcrumbs.map((b, i) => (
          <span key={b.id}>
            {i > 0 && <span className="crumb-sep"> / </span>}
            <Link to={`/${bookSlug}/sections/${b.id}`}>
              {b.numbering ? `${b.numbering} ${b.title}` : b.title}
            </Link>
          </span>
        ))}
      </nav>

      <div className="section-heading-row">
        <h1>
          {section.numbering && (
            <span className="section-numbering">{section.numbering}</span>
          )}
          {section.title}
        </h1>
        {!editing && editor && (
          <button
            type="button"
            className="section-edit-button"
            disabled={!editorReady}
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            Edit
          </button>
        )}
      </div>

      <div className="no-print">
        <Link to={`/${bookSlug}/print/${section.chapter_id}`}>
          Print chapter / PDF
        </Link>
      </div>
      {editor && (
        <div className="panel no-print">
          <p>
            Status: {section.status}
            {draft !== null ? " · Unpublished changes" : ""}
          </p>
          <button
            onClick={async () => {
              try {
                await api.post(`/api/sections/${id}/publish`, {});
                setData(await api.section(id));
                setDraft(null);
                const r = await api.get(`/api/sections/${id}/revisions`);
                setRevisions(r.revisions);
                await refresh();
                setNotice("Published");
              } catch (e) {
                setNotice(e.message);
              }
            }}
          >
            Publish saved draft
          </button>
          <details>
            <summary>Version history / undo</summary>
            {revisions.map((r) => (
              <p key={r.id}>
                {new Date(r.created_at).toLocaleString()}{" "}
                <button
                  onClick={async () => {
                    try {
                      await api.post(`/api/sections/${id}/restore/${r.id}`, {});
                      const d = await api.get(`/api/sections/${id}/editor`);
                      setDraft(d.draft_markdown);
                      setEditing(false);
                      setNotice(
                        "Version restored as a draft. Edit to review, then publish.",
                      );
                    } catch (e) {
                      setNotice(e.message);
                    }
                  }}
                >
                  Restore as draft
                </button>
              </p>
            ))}
          </details>
          <p role="status">{notice}</p>
        </div>
      )}
      {editing && editor && editorReady ? (
        <MarkdownEditor
          title={
            section.numbering
              ? `${section.numbering} ${section.title}`
              : section.title
          }
          initialValue={draft ?? blocksToMarkdown(blocks)}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="section-content">
          {blocks.length === 0 && (
            <p className="empty">No content in this section.</p>
          )}
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
      <Annotations id={id} />
      <SectionNavigation id={id} slug={bookSlug} toc={toc} />
    </article>
  );
}
