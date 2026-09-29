import fs from "node:fs";
import path from "node:path";
import { parseFile } from "./parseFile.js";

const CHAPTER_DIR_RE = /^(\d{3})_(.+)$/;
const SKIP_DIRS = new Set(["images", "node_modules", ".git", "docs", "migration"]);

// The front matter is a handful of loose root files, several with no real
// heading of their own (BookMetadata.md has none at all) or headings that
// don't say what the page is (CoverPage.md's heading is the author's name).
// Curated by hand rather than inferred: one flat section per listed file, in
// this order, no nesting. Files not listed here (a blank page-break
// artifact, a dropped dedication page) are excluded from the outline.
const FRONT_MATTER_FILES = [
  { file: "0001_CoverPage.md", title: "Cover Page" },
  { file: "0002_Publication.md", title: "Publication" },
  { file: "0005_BookMetadata.md", title: "Book Metadata" },
  { file: "0006_Foreword.md", title: "Foreword" },
  { file: "0008_Preface.md", title: "Preface" },
  { file: "0010_Acknowledgement.md", title: "Acknowledgement" },
];

function titleFromSlug(slug) {
  return slug.replace(/_/g, " ").trim();
}

function listMarkdownFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

// A "chapter" is either one of the numbered folders (000_First .. 016_Appendix)
// or the loose front-matter files sitting at the repo root (cover page,
// publication, dedication, ...), which we group into a synthetic chapter.
function listChapters(rootDir) {
  const chapters = [];

  const rootFiles = listMarkdownFiles(rootDir);
  if (rootFiles.length) {
    chapters.push({
      number: null,
      slug: "front-matter",
      title: "Front Matter",
      files: rootFiles.map((f) => path.join(rootDir, f)),
    });
  }

  const dirEntries = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && CHAPTER_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const dirName of dirEntries) {
    const [, prefix, slug] = dirName.match(CHAPTER_DIR_RE);
    chapters.push({
      number: prefix === "000" ? null : String(Number(prefix)),
      slug,
      title: titleFromSlug(slug),
      files: listMarkdownFiles(path.join(rootDir, dirName)).map((f) =>
        path.join(rootDir, dirName, f)
      ),
    });
  }

  return chapters;
}

function depthOf(numbering) {
  return numbering ? numbering.split(".").length : 1;
}

/**
 * Turns a chapter's ordered list of parsed-file items into a tree of
 * sections, each carrying its own ordered content_blocks. Depth is derived
 * from the heading's numbering ("3.3.1" -> depth 3), not from the markdown
 * `#` level, because the source is inconsistent about heading levels.
 *
 * The source also uses markdown heading syntax for things that are not
 * real document sections - glossed morpheme labels like "{a-}:", list
 * lead-ins like "a) Adding personal prenominal prefixes:", worked-example
 * lines. Those have no numbering. Rather than giving each one a tree node
 * (which produced a staircase of ever-deeper, individually-navigable
 * "sections" - see docs/migration.md), every unnumbered heading is
 * flattened into a `subheading` content block on the nearest numbered
 * ancestor section: same reading-order position, not a nav item.
 */
function attachToSections(parsedFiles) {
  const roots = [];
  const stack = []; // stack[depth] = currently open numbered section at that depth
  let current = null; // most recently opened section of any kind - where content blocks attach
  let numberedSection = null; // nearest ancestor with real numbering - the flatten target
  let sectionOrder = 0;

  function openSection(numbering, title, sourceFile) {
    const depth = depthOf(numbering);
    const section = {
      numbering,
      title,
      depth,
      sort_order: sectionOrder++,
      source_file: sourceFile,
      blocks: [],
      children: [],
    };

    if (depth === 1) {
      roots.push(section);
      stack.length = 0;
    } else {
      let parentDepth = depth - 1;
      while (parentDepth > 0 && !stack[parentDepth]) parentDepth--;
      const parent = stack[parentDepth];
      if (parent) parent.children.push(section);
      else roots.push(section); // no shallower heading seen yet; promote to root
    }

    stack[depth] = section;
    stack.length = depth + 1;
    current = section;
    // Only a real numbered section becomes the flattening target - an
    // unnumbered fallback root (see below) shouldn't collect later,
    // unrelated unnumbered headings under itself.
    if (numbering) numberedSection = section;
    return section;
  }

  for (const { sourceFile, items } of parsedFiles) {
    for (const item of items) {
      if (item.kind === "heading" && item.numbering) {
        openSection(item.numbering, item.title, sourceFile);
        continue;
      }
      if (item.kind === "heading") {
        // Unnumbered heading with nothing numbered open yet (rare - only
        // possible before the first real heading in a chapter): promote it
        // to a section of its own so the content isn't lost.
        if (!numberedSection) {
          openSection(null, item.title, sourceFile);
          continue;
        }
        numberedSection.blocks.push({
          kind: "block",
          block_type: "subheading",
          content: { text: item.title },
        });
        continue;
      }
      if (!current) {
        openSection(null, "Untitled", sourceFile);
      }
      current.blocks.push(item);
    }
  }

  return roots;
}

function buildFrontMatterSections(rootDir) {
  return FRONT_MATTER_FILES.map(({ file, title }, i) => {
    const items = parseFile(fs.readFileSync(path.join(rootDir, file), "utf8"));
    return {
      numbering: null,
      title,
      depth: 1,
      sort_order: i,
      source_file: file,
      // Drop heading items - the section already carries its title above,
      // and nesting is intentionally flat here (see FRONT_MATTER_FILES).
      blocks: items.filter((item) => item.kind === "block"),
      children: [],
    };
  });
}

export function buildOutlineByNumbering(rootDir) {
  return listChapters(rootDir).map((chapter, chapterIndex) => {
    const sections =
      chapter.slug === "front-matter"
        ? buildFrontMatterSections(rootDir)
        : attachToSections(
            chapter.files.map((filePath) => ({
              sourceFile: path.relative(rootDir, filePath),
              items: parseFile(fs.readFileSync(filePath, "utf8")),
            }))
          );

    return {
      number: chapter.number,
      slug: chapter.slug,
      title: chapter.title,
      sort_order: chapterIndex,
      sections,
    };
  });
}
