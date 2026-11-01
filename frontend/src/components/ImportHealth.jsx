import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CircleCheck, FileQuestion, ImageOff, Code2 } from "lucide-react";
import { api } from "../api";
import ReadingSkeleton from "./common/ReadingSkeleton";
import { EmptyState, ErrorState } from "./common/States";

// Editors only: what book-import found the last time it loaded this book -
// parse problems, images it couldn't find, code that doesn't parse, and
// sections with no content - each linked to its section.
export default function ImportHealth() {
  const { bookSlug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .importReport(bookSlug)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [bookSlug]);

  if (error) return <ErrorState title="Couldn’t load the import report" message={error} />;
  if (!data) return <ReadingSkeleton />;

  const { report, issues, missingImages, emptySections } = data;
  const problems = issues.filter((d) => d.severity !== "info");
  const syntax = issues.filter((d) => d.code === "code.syntax_error");
  const syntaxTotal = report?.stats?.byCode?.["code.syntax_error"] ?? syntax.length;

  return (
    <article className="animate-in fade-in-0 duration-300">
      <header className="mb-8 border-b pb-6">
        <p className="mb-3 text-[13px] font-semibold tracking-wide text-primary">Editors</p>
        <h1 className="font-serif text-[2.75rem] font-medium leading-tight tracking-[-0.015em]">Import health</h1>
        {report ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Last {report.mode === "load" ? "loaded" : report.mode === "reset" ? "replaced" : "reloaded"}{" "}
            {new Date(report.loadedAt).toLocaleString()} from <code className="text-xs">{report.sourceDir}</code>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No import report yet - it's saved the next time book-import loads or reloads this book.
          </p>
        )}
      </header>

      {report && (
        <dl className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Chapters", report.stats.chapters],
            ["Sections", report.stats.sections],
            ["Code blocks", report.stats.codeBlocks],
            ["Content blocks", report.stats.blocks],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-serif text-2xl tabular-nums">{value ?? "–"}</dd>
            </div>
          ))}
        </dl>
      )}

      <Group
        icon={AlertTriangle}
        title="Problems"
        empty="No errors or warnings."
        count={problems.length}
        items={problems}
        render={(d) => (
          <>
            <span className={d.severity === "error" ? "font-medium text-destructive" : "font-medium"}>{d.severity}</span>{" "}
            <code className="text-xs text-muted-foreground">{d.code}</code> - {d.message}
          </>
        )}
      />
      <Group
        icon={ImageOff}
        title="Missing images"
        empty="Every image was found."
        count={missingImages.length}
        items={missingImages}
        render={(m) => <code className="text-xs">{m.src}</code>}
      />
      <Group
        icon={FileQuestion}
        title="Sections with no content"
        empty="Every section has content."
        count={emptySections.length}
        items={emptySections.map((s) => ({ section: { id: s.id, title: s.title, chapter: s.chapter } }))}
        render={() => null}
      />
      <Group
        icon={Code2}
        title="Code that doesn't parse"
        note="Often fine: interactive sessions, fragments and program output aren't whole programs. Worth a look when a book's code was rebuilt from plain text."
        empty="All code blocks parse."
        count={syntaxTotal}
        shownNote={syntax.length < syntaxTotal ? `showing the first ${syntax.length}` : null}
        items={syntax}
        render={(d) => d.message}
        collapsed
      />
    </article>
  );
}

function Group({ icon: Icon, title, note, empty, count, shownNote, items, render, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-medium">
        {count ? <Icon className="size-4 text-muted-foreground" /> : <CircleCheck className="size-4 text-primary" />}
        {title}
        <span className="text-sm font-normal tabular-nums text-muted-foreground">{count}</span>
      </h2>
      {note && count > 0 && <p className="mb-3 text-sm text-muted-foreground">{note}</p>}
      {!count ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-primary hover:underline">
          Show them{shownNote ? ` (${shownNote})` : ""}
        </button>
      ) : items.length ? (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {items.map((item, i) => (
            <li key={i} className="grid gap-1 px-4 py-3">
              {render(item) && <div>{render(item)}</div>}
              <Where item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing listed" />
      )}
    </section>
  );
}

function Where({ item }) {
  const { bookSlug } = useParams();
  const place = [item.file, item.line].filter(Boolean).join(":");
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {item.section && (
        <Link to={`/${bookSlug}/sections/${item.section.id}`} className="font-medium text-primary hover:underline">
          {item.section.chapter} › {item.section.title}
        </Link>
      )}
      {place && <code>{place}</code>}
    </div>
  );
}
