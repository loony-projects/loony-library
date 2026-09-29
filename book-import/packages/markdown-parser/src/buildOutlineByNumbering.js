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
// Each entry's role is part of the same hand curation.
const FRONT_MATTER_FILES = [
  { file: "0001_CoverPage.md", title: "Cover Page", role: "cover" },
  { file: "0002_Publication.md", title: "Publication", role: "copyright" },
  { file: "0005_BookMetadata.md", title: "Book Metadata", role: "front_matter" },
  { file: "0006_Foreword.md", title: "Foreword", role: "foreword" },
  { file: "0008_Preface.md", title: "Preface", role: "preface" },
  { file: "0010_Acknowledgement.md", title: "Acknowledgement", role: "acknowledgments" },
];

function normalizeTitle(text) {
  return text.trim().toLowerCase().replace(/\.+$/, "");
}

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
function attachToSections(parsedFiles, diagnostics) {
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
          position: item.position,
        });
        continue;
      }
      if (!current) {
        diagnostics.info(
          "structure.content_before_first_heading",
          "Content before the chapter's first heading kept in an \"Untitled\" section.",
          { position: item.position, file: sourceFile }
        );
        openSection(null, "Untitled", sourceFile);
      }
      current.blocks.push(item);
    }
  }

  return roots;
}

function buildFrontMatterSections(rootDir, diagnostics) {
  const listed = new Set(FRONT_MATTER_FILES.map((f) => f.file));
  for (const file of listMarkdownFiles(rootDir)) {
    if (!listed.has(file)) {
      diagnostics.warning("source.file_not_in_outline", `Front-matter file ${file} is not in FRONT_MATTER_FILES; not in the outline.`, { file });
    }
  }
  return FRONT_MATTER_FILES.filter(({ file }) => {
    if (fs.existsSync(path.join(rootDir, file))) return true;
    diagnostics.warning("source.missing_file", `Front-matter file ${file} does not exist; section skipped.`, { file });
    return false;
  }).map(({ file, title, role }, i) => {
    const items = parseFile(fs.readFileSync(path.join(rootDir, file), "utf8"), { file, diagnostics });
    return {
      role,
      numbering: null,
      title,
      depth: 1,
      sort_order: i,
      source_file: file,
      // Nesting is intentionally flat here (see FRONT_MATTER_FILES): a
      // heading that repeats the section's own title is dropped, any other
      // heading is kept in place as a subheading.
      blocks: items.flatMap((item) => {
        if (item.kind === "block") return [item];
        const text = item.numbering ? `${item.numbering}. ${item.title}` : item.title;
        if (normalizeTitle(text) === normalizeTitle(title)) return [];
        return [{ kind: "block", block_type: "subheading", content: { text }, position: item.position }];
      }),
      children: [],
    };
  });
}

export function buildOutlineByNumbering(rootDir, { diagnostics }) {
  return listChapters(rootDir).map((chapter, chapterIndex) => {
    const sections =
      chapter.slug === "front-matter"
        ? buildFrontMatterSections(rootDir, diagnostics)
        : attachToSections(
            chapter.files.map((filePath) => {
              const sourceFile = path.relative(rootDir, filePath);
              return { sourceFile, items: parseFile(fs.readFileSync(filePath, "utf8"), { file: sourceFile, diagnostics }) };
            }),
            diagnostics
          );

    return {
      role: chapter.slug === "front-matter" ? "front_matter" : "chapter",
      number: chapter.number,
      slug: chapter.slug,
      title: chapter.title,
      sort_order: chapterIndex,
      sections,
    };
  });
}
