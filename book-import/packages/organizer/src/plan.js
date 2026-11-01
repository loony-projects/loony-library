import fs from "node:fs";
import path from "node:path";
import { parseFile } from "@loony-library/markdown-parser";
import { findContentsFiles, readContentsList } from "./contents.js";
import { readPdfContents } from "./contents-pdf.js";

// Plans where each chapter's sections start, without touching anything.
//
// Chapter folders are numbered folders (NN_<Title>) holding page files and
// no section folders yet. Sections come from the book's contents list,
// located as headings in the chapter's pages near their printed page; a
// chapter the contents list doesn't cover (or a book without one) uses its
// numbered N.1, N.2 ... headings instead.

const NUMBERED_DIR = /^(\d{2,3})_(.+)$/;
const MATTER = /^(?:front|back|end|last)_?(?:pages?|matter)$/i;

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });
export const key = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
// PDF page of a page file (book_page_0042.md), if its name says.
const pageNo = (file) => Number(file.match(/_page_(\d+)\.md$/)?.[1] ?? NaN);

function entries(dir) {
  const all = fs.readdirSync(dir, { withFileTypes: true });
  return {
    files: all.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort(byName),
    dirs: all.filter((e) => e.isDirectory() && NUMBERED_DIR.test(e.name)).map((e) => e.name).sort(byName),
  };
}

// Chapter folders that can be split: numbered, not front/back matter, with
// pages and no section folders.
export function chapterFolders(root) {
  return entries(root).dirs.filter((d) => {
    if (MATTER.test(d.replace(NUMBERED_DIR, "$2"))) return false;
    const inner = entries(path.join(root, d));
    return inner.files.length > 0 && inner.dirs.length === 0;
  });
}

function headingsOf(root, dir) {
  const files = entries(path.join(root, dir)).files;
  const ordered = files.every((f) => Number.isFinite(pageNo(f))) ? [...files].sort((a, b) => pageNo(a) - pageNo(b)) : files;
  return {
    files: ordered,
    headings: ordered.flatMap((file) =>
      parseFile(fs.readFileSync(path.join(root, dir, file), "utf8"))
        .filter((item) => item.kind === "heading")
        .map((item) => {
          // The parser splits digit numbering ("1.1 ..."); appendices use letters ("A.1 ...").
          const letter = item.numbering ? null : item.title.match(/^([A-Z]\.\d+(?:\.\d+)*)\.?\s+(.+)$/);
          const numbering = item.numbering ?? letter?.[1] ?? null;
          const title = letter ? letter[2] : item.title;
          return { file, page: pageNo(file), line: item.position.start.line, numbering, title, keys: [key(title), key(numbering ? `${numbering} ${title}` : title)] };
        })
    ),
  };
}

// The contents chapter a folder holds: by title, else by its NN_ number.
function folderFor(chapter, folders, used) {
  const want = key(chapter.title);
  const titled = folders.find((d) => {
    if (used.has(d)) return false;
    const k = key(d.replace(NUMBERED_DIR, "$2"));
    return want.length >= 4 && (k === want || k.startsWith(want) || want.startsWith(k));
  });
  return titled ?? folders.find((d) => !used.has(d) && Number(d.match(NUMBERED_DIR)[1]) === chapter.number) ?? null;
}

// The book's PDF page offset (PDF page - printed page), the most common one
// across chapters: a chapter folder may start a page or two early with a
// part opener.
function pageOffset(root, pairs) {
  const counts = new Map();
  for (const { chapter, dir } of pairs) {
    const first = Math.min(...entries(path.join(root, dir)).files.map(pageNo));
    if (!Number.isFinite(first) || chapter.page == null) continue;
    counts.set(first - chapter.page, (counts.get(first - chapter.page) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function locate(headings, listed, offset) {
  let cursor = -1;
  const found = [];
  const missing = [];
  for (const s of listed) {
    const want = key(s.title);
    const expect = offset != null && s.page != null ? s.page + offset : null;
    const idx = headings.findIndex(
      (h, j) =>
        j > cursor &&
        (expect == null || !Number.isFinite(h.page) || Math.abs(h.page - expect) <= 2) &&
        h.keys.some((k) => k === want || (want.length > 6 && k.startsWith(want)))
    );
    if (idx === -1) {
      missing.push(s);
      continue;
    }
    cursor = idx;
    const h = headings[idx];
    found.push({ number: s.number, title: s.title, file: h.file, line: h.line });
  }
  return { found, missing };
}

// N.1, N.2 ... headings (A.1 in an appendix): the chapter's own number is the
// most common first part; deeper N.M.K headings are subsections.
function numberedSections(headings) {
  const two = headings.filter((h) => h.numbering && /^(?:\d+|[A-Z])\.\d+$/.test(h.numbering));
  const counts = new Map();
  two.forEach((h) => counts.set(h.numbering.split(".")[0], (counts.get(h.numbering.split(".")[0]) ?? 0) + 1));
  const chapter = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const seen = new Set();
  return two
    .filter((h) => h.numbering.split(".")[0] === chapter && !seen.has(h.numbering) && seen.add(h.numbering))
    .map((h) => ({ number: h.numbering, title: h.title, file: h.file, line: h.line }));
}

// pdfContents: { pdf, first, last } - read the contents list from those PDF
// pages instead of the Markdown contents page.
export function planSections(root, { contents = null, pdfContents = null } = {}) {
  const folders = chapterFolders(root);
  const contentsFiles = pdfContents ? [] : findContentsFiles(root, contents);
  const list = pdfContents ? readPdfContents(pdfContents.pdf, pdfContents.first, pdfContents.last) : readContentsList(contentsFiles);
  const used = new Set();
  const pairs = [];
  for (const chapter of [...list.values()].sort((a, b) => a.number - b.number)) {
    const dir = folderFor(chapter, folders, used);
    if (dir) {
      used.add(dir);
      pairs.push({ chapter, dir });
    }
  }
  const offset = pageOffset(root, pairs);
  const problems = [];
  const chapters = [];

  for (const { chapter, dir } of pairs) {
    const { files, headings } = headingsOf(root, dir);
    const { found, missing } = locate(headings, chapter.sections, offset);
    for (const s of missing) problems.push(`${dir}: "${[s.number, s.title].filter(Boolean).join(" ")}" (printed p.${s.page}) has no matching heading - left where it is`);
    chapters.push({ dir, number: chapter.number, title: chapter.title, source: "contents", pages: files.length, listed: chapter.sections.length, subsections: chapter.subsections, sections: found });
  }
  for (const dir of folders.filter((d) => !used.has(d))) {
    const { files, headings } = headingsOf(root, dir);
    chapters.push({ dir, number: null, title: dir.replace(NUMBERED_DIR, "$2").replace(/_+/g, " "), source: "headings", pages: files.length, listed: null, subsections: null, sections: numberedSections(headings) });
  }
  chapters.sort((a, b) => byName(a.dir, b.dir));
  const source = pdfContents ? `${path.basename(pdfContents.pdf)} pages ${pdfContents.first}-${pdfContents.last}` : null;
  return { root, contentsFiles: source ? [source] : contentsFiles.map((f) => path.relative(root, f)), offset, chapters, problems };
}
