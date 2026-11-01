import { execFileSync } from "node:child_process";

// The contents list read from the book's PDF, for books whose Markdown
// contents page lost its indentation (a flattened table). `pdftotext
// -layout` keeps it:
//
//   5. Text Generation. . . . . . . . . . . . 123
//        Greedy Search Decoding                127    <- a section
//          Top-k and Nucleus Sampling          136    <- a subsection
//
// Odd and even pages have different left margins, so indentation is only
// compared within a page: its least-indented entries are sections.
// Same shape as readContentsList: chapter number -> { number, title, page,
// sections, subsections }.
const CHAPTER = /^\s{0,3}(\d+)\.\s+(.+?)[\s.]*\s(\d+)$/;
const ENTRY = /^(\s+)(\S.*?)\s{2,}(\d+)$/;
const OTHER = /^\S.*\.\s?\.\s?\./; // Index . . . . 371 ends the chapter

export function readPdfContents(pdf, first, last) {
  const text = execFileSync("pdftotext", ["-layout", "-f", String(first), "-l", String(last), pdf, "-"], { encoding: "utf8" });
  const chapters = new Map();
  let current = null;
  for (const page of text.split("\f")) {
    const onPage = [];
    for (const line of page.split("\n")) {
      if (!line.trim()) continue;
      const ch = line.match(CHAPTER);
      if (ch) {
        current = { number: Number(ch[1]), title: ch[2].replace(/\.$/, "").trim(), page: Number(ch[3]), entries: [] };
        chapters.set(current.number, current);
        continue;
      }
      const e = line.match(ENTRY);
      if (e && current) {
        const entry = { indent: e[1].length, title: e[2].trim(), page: Number(e[3]) };
        current.entries.push(entry);
        onPage.push(entry);
      } else if (OTHER.test(line)) current = null;
    }
    const base = Math.min(...onPage.map((e) => e.indent));
    for (const e of onPage) e.level = e.indent === base ? 1 : 2;
  }
  for (const c of chapters.values()) {
    c.sections = c.entries.filter((e) => e.level === 1).map(({ title, page }) => ({ number: "", title, page }));
    c.subsections = c.entries.length - c.sections.length;
    delete c.entries;
  }
  return chapters;
}
