import fs from "node:fs";
import path from "node:path";
import { parseFile } from "./parseFile.js";

const PAGE_FILE_RE = /_page_(\d+)\.md$/;

function listPages(rootDir) {
  return fs
    .readdirSync(rootDir)
    .filter((f) => PAGE_FILE_RE.test(f))
    .map((f) => ({ file: f, page: Number(f.match(PAGE_FILE_RE)[1]) }))
    .sort((a, b) => a.page - b.page);
}

/**
 * Strategy for books whose source is a flat dump of per-page markdown files
 * (pdf-to-md's raw output) rather than curated chapter directories, and
 * which don't have a numbering scheme in their headings to derive tree depth
 * from (see buildOutlineByNumbering.js for that case).
 *
 * Chapter boundaries here are driven by explicit page numbers in the book
 * config rather than by matching heading text: this book's own heading
 * levels are inconsistent (some subsection headings sit at the same `##`
 * level as real chapters - e.g. the six subtypes of the "बिसुं" chapter),
 * and one chapter's title heading was lost entirely to a skipped OCR page.
 * Page numbers were verified once against the source and are ground truth,
 * not inferred at parse time.
 *
 * Each chapter becomes exactly one flat section (no nested sub-sections) -
 * every heading found within a chapter's page range, at any level, becomes
 * an in-place `subheading` content block rather than a nav-tree child.
 */
export function buildOutlineFlatChapters(rootDir, config) {
  const pages = listPages(rootDir);
  const frontMatterPages = new Map((config.frontMatter ?? []).map((f) => [f.page, f.title]));
  const chapters = [...config.chapters].sort((a, b) => a.startPage - b.startPage);

  function chapterForPage(pageNum) {
    let match = null;
    for (const c of chapters) {
      if (c.startPage > pageNum) break;
      match = c;
    }
    return match;
  }

  const frontMatterChapter = {
    number: null,
    slug: "front-matter",
    title: "Front Matter",
    sort_order: 0,
    sections: [],
  };

  const bookChapters = [];
  const chapterById = new Map();
  for (const [i, c] of chapters.entries()) {
    const section = {
      numbering: null,
      title: c.title,
      depth: 1,
      sort_order: 0,
      source_file: null,
      blocks: [],
      children: [],
    };
    const chapter = {
      number: c.number,
      slug: c.slug ?? String(i + 1),
      title: c.title,
      sort_order: i + 1, // 0 is reserved for the front-matter chapter
      sections: [section],
    };
    bookChapters.push(chapter);
    chapterById.set(c.startPage, { chapter, section });
  }

  let frontMatterSortOrder = 0;
  let openSection = null; // the single flat section of whichever chapter is currently open
  let chapterStartPage = null; // startPage of the currently open chapter, to know when we've just entered it

  for (const { file, page } of pages) {
    const items = parseFile(fs.readFileSync(path.join(rootDir, file), "utf8"));

    if (frontMatterPages.has(page)) {
      const title = frontMatterPages.get(page);
      const section = {
        numbering: null,
        title,
        depth: 1,
        sort_order: frontMatterSortOrder++,
        source_file: file,
        blocks: items.filter((item) => item.kind === "block"),
        children: [],
      };
      frontMatterChapter.sections.push(section);
      continue;
    }

    const entry = chapterForPage(page);
    if (!entry) continue; // pages before the first chapter and not listed as front matter are dropped

    if (entry.startPage !== chapterStartPage) {
      chapterStartPage = entry.startPage;
      openSection = chapterById.get(entry.startPage).section;
    }

    for (const [i, item] of items.entries()) {
      // The chapter's own title heading (first item, on its first page) is
      // consumed as the chapter marker rather than duplicated as content -
      // unless the page has no heading at all (the one chapter whose title
      // page was lost to a skipped OCR page starts directly with body text).
      if (page === entry.startPage && i === 0 && item.kind === "heading") continue;

      if (item.kind === "heading") {
        // parseFile splits off a leading bare-digit numbering into its own
        // field (needed by the numbering strategy); this strategy doesn't
        // use that field for structure, so fold it back into the display
        // text rather than silently dropping enumeration like "3." from a
        // numbered subheading such as "3. बिसुबुं बिसुं (Determinative Compound)".
        const text = item.numbering ? `${item.numbering}. ${item.title}` : item.title;
        openSection.blocks.push({ kind: "block", block_type: "subheading", content: { text } });
        continue;
      }
      openSection.blocks.push(item);
    }
  }

  const result = [];
  if (frontMatterChapter.sections.length) result.push(frontMatterChapter);
  result.push(...bookChapters);
  return result;
}
