import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "../api";
import Block from "./Blocks";
import ReadingSkeleton from "./common/ReadingSkeleton";
import { ErrorState } from "./common/States";
import { Button } from "@/components/ui/button";

export default function ChapterPrint() {
  const { bookSlug, chapterId } = useParams();
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .toc(bookSlug)
      .then(async (toc) => {
        const chapter =
          chapterId === "all"
            ? {
                title: "Complete book",
                sections: toc.chapters.flatMap((c) => c.sections),
              }
            : toc.chapters.find((c) => c.id === chapterId);
        if (!chapter) throw new Error("Chapter not found");
        const ids = [];
        function walk(nodes) {
          for (const n of nodes) {
            ids.push(n.id);
            walk(n.children);
          }
        }
        walk(chapter.sections);
        const sections = await Promise.all(ids.map((id) => api.section(id)));
        if (active) setData({ chapter, sections });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [bookSlug, chapterId]);
  return (
    <div className="min-h-dvh">
      <div className="no-print sticky top-0 z-10 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-5">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to={`/${bookSlug}`}>
              <ArrowLeft /> Back to book
            </Link>
          </Button>
          <Button size="sm" disabled={!data} onClick={() => window.print()}>
            <Printer /> Print / Save as PDF
          </Button>
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-5 py-12 print:max-w-none print:p-0">
        {error && <ErrorState message={error} />}
        {!data && !error && (
          <>
            <p className="mb-8 text-sm text-muted-foreground">Preparing chapter…</p>
            <ReadingSkeleton />
          </>
        )}
        {data && (
          <div className="reading">
            <h1 className="!mt-0 font-serif text-[2.4em] font-medium tracking-tight">
              {data.chapter.title}
            </h1>
            {data.sections.map((d) => (
              <section key={d.section.id}>
                <h2>{d.section.title}</h2>
                {d.blocks.map((b) => (
                  <Block key={b.id} block={b} />
                ))}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
