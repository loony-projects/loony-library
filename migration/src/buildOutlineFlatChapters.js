import fs from "node:fs";
import path from "node:path";
import { parseFile } from "./parseFile.js";

const PAGE_FILE_RE = /_page_(\d+)\.md$/;

function normalizeHeadingText(text) {
  return text.trim().toLowerCase().replace(/\.+$/, "");
}

function listPages(rootDir) {
  return fs
    .readdirSync(rootDir)
    .filter((f) => PAGE_FILE_RE.test(f))
    .map((f) => ({ file: f, page: Number(f.match(PAGE_FILE_RE)[1]) }))
    .sort((a, b) => a.page - b.page);
}

// Every heading inside a chapter becomes one in-place `subheading` content
// block on that chapter's single flat section - no nav-tree children. Used
// when a book's headings can't be trusted to have real numbering (e.g.
// Jouga Boro Raokhanthi: unreliable heading levels, a chapter with no
// title heading at all).
function createFlatSink(chapterTitle) {
  const section = {
    numbering: null,
    title: chapterTitle,
    depth: 1,
    sort_order: 0,
    source_file: null,
    blocks: [],
    children: [],
  };
  return {
    rootSections: [section],
    pushHeading(item) {
      // parseFile splits off a leading bare-digit numbering into its own
      // field (needed by the numbering strategy); this sink doesn't use
      // that field for structure, so fold it back into the display text
      // rather than silently dropping enumeration like "3." from a
      // numbered subheading such as "3. बिसुबुं बिसुं (Determinative Compound)".
      const text = item.numbering ? `${item.numbering}. ${item.title}` : item.title;
      section.blocks.push({ kind: "block", block_type: "subheading", content: { text } });
    },
    pushBlock(item) {
      section.blocks.push(item);
    },
  };
}

// Builds a real section tree inside a chapter from its headings' numbering
// ("1.1" -> depth 2, "1.1.2" -> depth 3, ...), the same depth-from-numbering
// idea as buildOutlineByNumbering.js's attachToSections but scoped to one
// chapter's page range instead of a whole curated folder. Used for books
// whose chapters are marked separately from their content (e.g. Comprehensive
// Rust's "## Chapter N" markers) but whose subsections carry real, trustworthy
// numbering - so those subsections deserve to be real navigable/deep-linkable
// sections instead of flattened subheading blocks.
//
// A depth-2 heading ("1.1") has no depth-1 parent to nest under (chapters
// aren't numbered as sections themselves), so depth 2 is the root level
// here; an intro section (numbering: null, titled after the chapter) holds
// whatever content precedes the chapter's first numbered heading.
function createNumberedSink(chapterTitle) {
  const introSection = {
    numbering: null,
    title: chapterTitle,
    depth: 1,
    sort_order: 0,
    source_file: null,
    blocks: [],
    children: [],
  };
  const roots = [introSection];
  const stack = []; // stack[depth] = currently open numbered section at that depth
  let current = introSection;
  let sortOrder = 1;

  function openNumberedSection(numbering, title, sourceFile) {
    const depth = numbering.split(".").length;
    const section = { numbering, title, depth, sort_order: sortOrder++, source_file: sourceFile, blocks: [], children: [] };

    if (depth <= 2) {
      roots.push(section);
      stack.length = 0;
    } else {
      let parentDepth = depth - 1;
      while (parentDepth > 1 && !stack[parentDepth]) parentDepth--;
      const parent = stack[parentDepth];
      if (parent) parent.children.push(section);
      else roots.push(section); // no shallower heading seen yet; promote to root
    }

    stack[depth] = section;
    stack.length = depth + 1;
    current = section;
    return section;
  }

  return {
    rootSections: roots,
    pushHeading(item, sourceFile) {
      if (item.numbering) {
        openNumberedSection(item.numbering, item.title, sourceFile);
        return;
      }
      // Unnumbered heading (a "Listing N.N" label, an EXERCISE lead-in, ...)
      // - flatten onto whichever section is currently open, same as the
      // other two strategies do for their own unnumbered headings.
      current.blocks.push({ kind: "block", block_type: "subheading", content: { text: item.title } });
    },
    pushBlock(item) {
      current.blocks.push(item);
    },
  };
}

/**
 * Strategy for books whose source is a flat dump of per-page markdown files
 * (pdf-to-md's raw output) rather than curated chapter directories.
 *
 * Chapter boundaries are driven by explicit page numbers in the book config
 * rather than by matching heading text: heading levels in this shape of
 * source are often unreliable (some subsection headings sit at the same
 * `##` level as real chapters), and a chapter's title heading can be lost
 * entirely to a skipped OCR page. Page numbers were verified once against
 * the source and are ground truth, not inferred at parse time.
 *
 * What happens *inside* each chapter depends on `config.chapterSections`:
 * `"numbered"` builds a real section tree from the chapters' own heading
 * numbering (see createNumberedSink); anything else (the default) flattens
 * every heading into subheading blocks on one section per chapter (see
 * createFlatSink) - for books whose headings can't be trusted to carry
 * real, complete numbering.
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

  const createSink = config.chapterSections === "numbered" ? createNumberedSink : createFlatSink;

  const bookChapters = [];
  const chapterById = new Map();
  for (const [i, c] of chapters.entries()) {
    const sink = createSink(c.title);
    const chapter = {
      number: c.number,
      slug: c.slug ?? String(i + 1),
      title: c.title,
      sort_order: i + 1, // 0 is reserved for the front-matter chapter
      sections: sink.rootSections,
    };
    bookChapters.push(chapter);
    chapterById.set(c.startPage, { chapter, sink });
  }

  let frontMatterSortOrder = 0;
  let activeSink = null; // the sink of whichever chapter is currently open
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
      activeSink = chapterById.get(entry.startPage).sink;
    }

    for (const [i, item] of items.entries()) {
      // The chapter's own title heading (first item, on its first page) is
      // consumed as the chapter marker rather than duplicated as content -
      // unless the page has no heading at all (the one chapter whose title
      // page was lost to a skipped OCR page starts directly with body text).
      if (page === entry.startPage && i === 0 && item.kind === "heading") continue;

      // Some sources split the marker and the human-readable title into two
      // consecutive headings ("Chapter 3" then "Welcome to Day 1") rather
      // than combining them ("Chapter 31 Unsafe Rust"); when that second
      // heading just repeats the config's chapter title verbatim, drop it
      // too instead of surfacing it a second time as the chapter's own
      // first subheading.
      if (
        page === entry.startPage &&
        i === 1 &&
        item.kind === "heading" &&
        normalizeHeadingText(item.title) === normalizeHeadingText(entry.title)
      ) {
        continue;
      }

      if (item.kind === "heading") {
        activeSink.pushHeading(item, file);
        continue;
      }
      activeSink.pushBlock(item);
    }
  }

  const result = [];
  if (frontMatterChapter.sections.length) result.push(frontMatterChapter);
  result.push(...bookChapters);
  return result;
}
