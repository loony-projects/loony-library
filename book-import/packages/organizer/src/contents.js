import fs from "node:fs";
import path from "node:path";

// The book's contents list, as pdf-to-md writes it in a Chapters/ (or
// Contents/) folder:
//
//   # Table of Contents
//   ## Part I. Concepts
//   1. **From JavaScript to TypeScript** — 3
//      - History of JavaScript — 3          <- a section (least-indented entry)
//      - Vanilla JavaScript's Pitfalls — 4
//        - Costly Freedom — 4               <- a subsection: stays in its section
//   2. **The Type System** — 17
//   6. **Futures in Rust** _(continued)_    <- a chapter continued on the next page
//
// Sections may be numbered ("1.1 Threads in Rust — 2"); the number is kept
// apart from the title.

const CONTENTS_NAME = /^(?:\d+_)?(chapters|contents|table_of_contents|toc)(?:\.md)?$/i;
const CHAPTER_LINE = /^(\d+)\.\s+(?:\*\*)?(.+?)(?:\*\*)?(?:\s+_\(continued\)_)?(?:\s+—\s+(\d+))?\s*$/;
const ENTRY_LINE = /^(\s+)- (.+?)\s+—\s+(\d+)\s*$/;
const NUMBERED_TITLE = /^((?:\d+|[A-Z])(?:\.\d+)+)\s+(.+)$/;

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

// Markdown files of the contents list: a folder or file named Chapters,
// Contents or Table_of_Contents at the top of the book or one level down
// (00_FrontPages/Chapters/). `explicit` is a path relative to the book.
export function findContentsFiles(root, explicit = null) {
  if (explicit) {
    const full = path.resolve(root, explicit);
    if (!fs.existsSync(full)) throw new Error(`Contents not found: ${explicit}`);
    return fs.statSync(full).isDirectory() ? mdFiles(full) : [full];
  }
  const found = [];
  const look = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
      if (e.name === "images" || e.name.startsWith("_")) continue;
      const full = path.join(dir, e.name);
      if (CONTENTS_NAME.test(e.name)) found.push(...(e.isDirectory() ? mdFiles(full) : e.name.endsWith(".md") ? [full] : []));
      else if (e.isDirectory() && depth === 0) look(full, 1);
    }
  };
  look(root, 0);
  return found;
}

function mdFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort(byName).map((f) => path.join(dir, f));
}

// chapter number -> { number, title, page, sections: [{ number, title, page }], subsections }
export function readContentsList(files) {
  const chapters = new Map();
  let current = null;
  for (const line of files.map((f) => fs.readFileSync(f, "utf8")).join("\n").split("\n")) {
    const ch = line.match(CHAPTER_LINE);
    if (ch) {
      const number = Number(ch[1]);
      current = chapters.get(number) ?? { number, title: ch[2].trim(), page: null, entries: [] };
      if (current.page == null && ch[3]) current.page = Number(ch[3]);
      chapters.set(number, current);
      continue;
    }
    if (/^\S/.test(line)) {
      current = null; // a part heading, Preface, Index ... ends the chapter
      continue;
    }
    const e = line.match(ENTRY_LINE);
    if (e && current) {
      const numbered = e[2].match(NUMBERED_TITLE);
      current.entries.push({ indent: e[1].length, number: numbered?.[1] ?? "", title: (numbered?.[2] ?? e[2]).trim(), page: Number(e[3]) });
    }
  }
  for (const c of chapters.values()) {
    const base = Math.min(...c.entries.map((e) => e.indent));
    c.sections = c.entries.filter((e) => e.indent === base).map(({ number, title, page }) => ({ number, title, page }));
    c.subsections = c.entries.length - c.sections.length;
    delete c.entries;
  }
  return chapters;
}
