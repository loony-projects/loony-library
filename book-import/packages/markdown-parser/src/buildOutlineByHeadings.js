import { divisionOf } from "./roles.js";

// Stage 3 - book structure for a directory of Markdown files (strategy
// "headings", the default - see parseBookDirectory): the files are read in
// order as one continuous book, and heading levels plus explicit `{.role}`
// classes define the structure. Rules (also in docs/migration.md):
//
// 1. Chapter level = options.chapterLevel, else the shallowest heading level
//    used by any heading that isn't a part. A heading at that level (or
//    shallower) starts a top-level element with role "chapter".
// 2. A heading with a `{.role}` class always starts a top-level element with
//    that role, whatever its level ("### Appendix A {.appendix}"). `{.part}`
//    starts a part: following main-matter elements (chapter, interlude) get
//    `partId` pointing at it, until the next part or any front/back-matter
//    element.
// 3. Deeper headings become nested sections. Nesting follows heading level
//    relative to the nearest shallower open heading, so a skipped level
//    ("#" then "###") nests one step deeper and is reported, never dropped.
// 4. Every block belongs to a section. A top-level element's own content
//    before its first subheading goes into its leading "body" section
//    (titled like the element) - always created, so each element has one.
// 5. Content before the first heading goes into a synthetic "Front Matter"
//    element (role front_matter); a book with no headings at all becomes a
//    single element titled after the book.
// 6. Order is source order. Front matter appearing after main matter (or
//    main after back) is reported, not reordered.

const MAIN_ROLES_IN_PART = new Set(["chapter", "interlude"]);

export function slugify(text) {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function buildOutlineByHeadings(files, options, { diagnostics }) {
  const allItems = files.flatMap(({ file, items }) => items.map((item) => ({ item, file })));
  const headingLevels = allItems
    .filter(({ item }) => item.kind === "heading" && item.role !== "part")
    .map(({ item }) => item.level);
  const chapterLevel = options.chapterLevel ?? (headingLevels.length ? Math.min(...headingLevels) : 1);

  const chapters = [];
  const slugs = new Map();
  let currentPart = null;
  let chapter = null;
  let current = null; // section receiving blocks
  let stack = []; // open sections under the current chapter, by heading level
  let lastDivision = null;

  function uniqueSlug(title) {
    const base = slugify(title);
    const n = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  }

  function newSection({ role, numbering, title, level, depth, file, position }) {
    return { role, numbering, title, level, depth, sort_order: 0, source_file: file, position, blocks: [], children: [] };
  }

  function openChapter({ role, number = null, title, level = null, file, position }) {
    const division = divisionOf(role);
    if (lastDivision && division && order(division) < order(lastDivision)) {
      diagnostics.warning(
        "structure.matter_order",
        `${role} "${title}" (${division} matter) appears after ${lastDivision} matter; kept in source order.`,
        { position, file }
      );
    }
    if (division) lastDivision = order(division) > order(lastDivision) ? division : lastDivision;

    chapter = {
      role,
      number,
      slug: uniqueSlug(title),
      title,
      level,
      sort_order: chapters.length,
      position,
      partId: null,
      sections: [],
    };
    if (role === "part") currentPart = chapter;
    else if (MAIN_ROLES_IN_PART.has(role) && currentPart) chapter.partRef = currentPart;
    else currentPart = null;

    chapters.push(chapter);
    const body = newSection({ role: "body", numbering: null, title, level, depth: 1, file, position });
    chapter.sections.push(body);
    current = body;
    stack = [];
    return chapter;
  }

  function ensureChapter(file, position, { noHeadings = false } = {}) {
    if (chapter) return;
    if (noHeadings) {
      diagnostics.warning("structure.no_headings", "Book has no headings; all content is kept in one element.", { file });
      openChapter({ role: "chapter", title: options.title || "Untitled", file, position });
    } else {
      diagnostics.info("structure.content_before_first_heading", "Content before the first heading kept in a Front Matter element.", {
        position,
        file,
      });
      openChapter({ role: "front_matter", title: "Front Matter", file, position });
    }
  }

  const hasHeadings = allItems.some(({ item }) => item.kind === "heading");

  for (const { item, file } of allItems) {
    if (item.kind === "block") {
      ensureChapter(file, item.position, { noHeadings: !hasHeadings });
      current.blocks.push(item);
      continue;
    }

    const title = item.title || "Untitled";
    const topLevel = item.role !== null || item.level <= chapterLevel;
    if (topLevel) {
      openChapter({ role: item.role ?? "chapter", number: item.numbering, title, level: item.level, file, position: item.position });
      continue;
    }

    ensureChapter(file, item.position);
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const parentLevel = parent ? parent.level : chapter.level ?? chapterLevel;
    if (item.level > parentLevel + 1) {
      diagnostics.info(
        "heading.skipped_level",
        `Heading level ${item.level} follows level ${parentLevel}; nested one step deeper.`,
        { position: item.position }
      );
    }
    const section = newSection({
      role: "section",
      numbering: item.numbering,
      title,
      level: item.level,
      depth: parent ? parent.depth + 1 : 2,
      file,
      position: item.position,
    });
    (parent ? parent.children : chapter.sections).push(section);
    stack.push(section);
    current = section;
  }

  if (!allItems.length) diagnostics.warning("source.empty", "Book source contains no content.", {});
  return chapters;
}

const ORDER = { front: 0, main: 1, back: 2 };
function order(division) {
  return division ? ORDER[division] : -1;
}
