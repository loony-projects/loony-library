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
import { ChevronRight, History, Pencil, Printer, RotateCcw, Upload } from "lucide-react";
import { api } from "../api";
import { blocksToMarkdown } from "../markdown";
import { formatDate } from "@/lib/format";
import Block from "./Blocks";
import MarkdownEditor from "./MarkdownEditor";
import ReadingSkeleton from "./common/ReadingSkeleton";
import { EmptyState, ErrorState } from "./common/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

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
    [notice, setNotice] = useState(""),
    [publishing, setPublishing] = useState(false);
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
    return <ErrorState title="Couldn’t load this section" message={error} />;
  if (!data) return <ReadingSkeleton />;

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

  async function publish() {
    setPublishing(true);
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
    } finally {
      setPublishing(false);
    }
  }

  async function restore(revisionId) {
    try {
      await api.post(`/api/sections/${id}/restore/${revisionId}`, {});
      const d = await api.get(`/api/sections/${id}/editor`);
      setDraft(d.draft_markdown);
      setEditing(false);
      setNotice("Version restored as a draft. Edit to review, then publish.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  const trail = breadcrumbs.slice(0, -1);
  const chapter = toc?.chapters.find((c) => c.id === section.chapter_id);

  return (
    <article className="animate-in fade-in-0 duration-300">
      {(chapter || trail.length > 0) && (
        <nav aria-label="Breadcrumb" className="mb-5">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
            {chapter && (
              <li className="font-medium text-foreground/70">
                {chapter.number ? `${chapter.number}. ` : ""}
                {chapter.title}
              </li>
            )}
            {trail.map((b, i) => (
              <li key={b.id} className="flex items-center gap-1">
                {(i > 0 || chapter) && <ChevronRight className="size-3.5 opacity-60" />}
                <Link
                  to={`/${bookSlug}/sections/${b.id}`}
                  className="rounded-sm transition-colors hover:text-foreground"
                >
                  {b.numbering ? `${b.numbering} ${b.title}` : b.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <header className="mb-10">
        {section.numbering && (
          <p className="mb-3 font-sans text-[13px] font-semibold tabular-nums tracking-wide text-primary">
            § {section.numbering}
          </p>
        )}
        <h1 className="font-serif text-[2.1rem] font-medium leading-[1.12] tracking-[-0.015em] text-balance sm:text-[2.75rem]">
          {section.title}
        </h1>

        <div className="no-print mt-6 flex flex-wrap items-center gap-2 border-b pb-5">
          {editor && (
            <>
              <Badge variant={section.status === "published" ? "success" : "secondary"} className="capitalize">
                {section.status}
              </Badge>
              {draft !== null && <Badge variant="warning">Unpublished changes</Badge>}
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Tooltip content="Print chapter / PDF">
              <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground hover:text-foreground">
                <Link to={`/${bookSlug}/print/${section.chapter_id}`} aria-label="Print chapter / PDF">
                  <Printer />
                </Link>
              </Button>
            </Tooltip>
            {editor && (
              <>
                <DropdownMenu>
                  <Tooltip content="Version history / undo">
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Version history" className="text-muted-foreground hover:text-foreground">
                        <History />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tooltip>
                  <DropdownMenuContent className="max-h-80 w-72 overflow-y-auto">
                    <DropdownMenuLabel>Version history</DropdownMenuLabel>
                    {revisions.length === 0 && (
                      <p className="px-2.5 pb-2 text-sm text-muted-foreground">No earlier versions yet.</p>
                    )}
                    {revisions.map((r) => (
                      <DropdownMenuItem key={r.id} onSelect={() => restore(r.id)}>
                        <RotateCcw />
                        <span className="flex-1">{formatDate(r.created_at)}</span>
                        <span className="text-xs text-muted-foreground">Restore</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="soft" size="sm" onClick={publish} disabled={publishing}>
                  <Upload />
                  {publishing ? "Publishing…" : "Publish saved draft"}
                </Button>
                {!editing && (
                  <Button size="sm" disabled={!editorReady} onClick={() => setEditing(true)}>
                    <Pencil />
                    Edit
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {editor && notice && (
          <p role="status" className="no-print mt-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </header>

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
      ) : blocks.length === 0 ? (
        <EmptyState
          className="section-content rounded-xl border border-dashed py-12"
          title="Nothing here yet"
          description={
            children.length
              ? "This section is an introduction to the parts below."
              : editor
                ? "Start writing this section."
                : "This section has no content yet."
          }
          action={
            editor &&
            editorReady && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Write
              </Button>
            )
          }
        />
      ) : (
        <div className="section-content reading">
          {blocks.map((block) => (
            <Block key={block.id} block={block} />
          ))}
        </div>
      )}

      {children.length > 0 && (
        <nav aria-labelledby="in-this-section" className="mt-14">
          <h2 id="in-this-section" className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            In this section
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/${bookSlug}/sections/${c.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent/50"
                >
                  {c.numbering && (
                    <span className="w-10 shrink-0 text-sm tabular-nums text-muted-foreground">{c.numbering}</span>
                  )}
                  <span className="flex-1 font-serif text-[17px] group-hover:text-primary">{c.title}</span>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
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
