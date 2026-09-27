import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Block from "./Blocks";
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
    <main className="print-chapter">
      <div className="no-print">
        <Link to={`/${bookSlug}`}>← Back to book</Link>{" "}
        <button disabled={!data} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Preparing chapter…</p>}
      {data && (
        <>
          <h1>{data.chapter.title}</h1>
          {data.sections.map((d) => (
            <section key={d.section.id}>
              <h2>{d.section.title}</h2>
              {d.blocks.map((b) => (
                <Block key={b.id} block={b} />
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
