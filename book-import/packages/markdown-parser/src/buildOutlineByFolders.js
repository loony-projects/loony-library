import fs from "node:fs";
import path from "node:path";
import { parseFile } from "./parseFile.js";
import { normalizeRole } from "./roles.js";
import { slugify } from "./buildOutlineByToc.js";

// Stage 3 - book structure from folders, for a book already organized as
// docs/prompts/organize-book-markdown.md describes:
//
//   markdown/
//     01_FrontPages/          front matter: one section per file (01_Copyright.md -> "Copyright")
//     02_<Chapter_Title>/     a chapter: its loose pages are the chapter's opening,
//       <page>.md                each NN_ subfolder is a section
//       01_<Section_Title>/
//         <page>.md
//     03_Part_I_<Title>/      a folder whose first heading is "Part ..." is a part;
//     04_Part_I_<Chapter>/      later chapters with the same Part_ label belong to it
//     NN_Appendix_A_<Title>/  an appendix (or a folder whose first heading is "Appendix A ...")
//     NN_BackPages/           back matter: one section per file
//
// The folders are the structure; headings never create chapters or
// sections. A chapter's or section's own title heading (the first heading
// of its first page, when it matches the folder's title) gives the printed
// title and number and is consumed; every other heading stays in place as a
// subheading block.

const NUMBERED = /^(\d{2,3})_(.+)$/;
const FRONT = /^front_?pages?$/i;
const BACK = /^back_?pages?$/i;
const PART_LABEL = /^Part_([A-Za-z0-9]+)_(.+)$/;

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

function entriesOf(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return {
    files: entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort(byName),
    dirs: entries.filter((e) => e.isDirectory() && NUMBERED.test(e.name)).map((e) => e.name).sort(byName),
  };
}

// Whether a markdown directory is organized into numbered folders holding pages.
export function hasBookFolders(dir) {
  const { dirs } = entriesOf(dir);
  return dirs.some((d) => {
    const inner = entriesOf(path.join(dir, d));
    return inner.files.length > 0 || inner.dirs.length > 0;
  });
}

const titleFromName = (name) => name.replace(NUMBERED, "$2").replace(/_+/g, " ").trim();

// Letters and digits only, for comparing a folder name with a heading.
const key = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function headingText(item) {
  return item.numbering ? `${item.numbering} ${item.title}` : item.title;
}

// A heading's section number and title. parseHeadingText only splits digit
// numbering ("1.1 What is an LLM?"); appendix sections are numbered with
// their letter ("A.1 What is PyTorch").
const LETTER_NUMBERING = /^([A-Z]\.\d+(?:\.\d+)*)\.?\s+(.+)$/;
function numberAndTitle(item) {
  if (item.numbering) return { numbering: item.numbering, title: item.title };
  const m = item.title.match(LETTER_NUMBERING);
  return m ? { numbering: m[1], title: m[2] } : { numbering: null, title: item.title };
}

function readPages(root, relDir, files, diagnostics) {
  return files.map((file) => {
    const rel = path.join(relDir, file);
    return { file: rel, items: parseFile(fs.readFileSync(path.join(root, rel), "utf8"), { file: rel, diagnostics }) };
  });
}

// "CHAPTER 1 Hello Transformers" -> "Hello Transformers" (the number is kept separately).
const stripChapterLabel = (text) => text.replace(/^chap(?:ter|\.)?\s+[0-9ivxlc]+\b[.:]?\s*/i, "");

// The title heading a folder opens with, if it names the folder: "1 Understanding
// Large Language Models" for 02_Understanding_Large_Language_Models,
// "1.1 What is an LLM?" for 01_What_is_an_LLM, "Appendix A. Introduction to
// PyTorch" for 09_Appendix_A_Introduction_to_PyTorch.
function openingHeading(pages, folderTitle) {
  const first = pages[0]?.items.find((item) => item.kind === "heading");
  if (!first) return null;
  const want = key(folderTitle);
  const appendix = headingText(first).match(/^appendix\s+([a-z0-9]+)\b[.:]?\s*(.*)$/i);
  // "CHAPTER 1 Hello Transformers" names 02_Hello_Transformers too.
  const withoutChapterLabel = stripChapterLabel(headingText(first));
  const candidates = [
    key(first.title),
    key(headingText(first)),
    key(numberAndTitle(first).title),
    key(withoutChapterLabel),
    appendix ? key(appendix[2]) : null,
    appendix ? key(`Appendix ${appendix[1]} ${appendix[2]}`) : null,
  ];
  const matches = candidates.some((c) => c && want && (c === want || c.startsWith(want) || want.startsWith(c)));
  return matches ? first : null;
}

// Blocks of a run of pages: headings become subheadings, except `consume`
// (the folder's own title heading).
function blocksOf(pages, consume = null) {
  const blocks = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item === consume) continue;
      if (item.kind === "block") blocks.push(item);
      else {
        const text = headingText(item);
        if (text) blocks.push({ kind: "block", block_type: "subheading", content: { text }, position: item.position });
      }
    }
  }
  return blocks;
}

function section({ role, numbering = null, title, depth, file, position, blocks }) {
  return { role, numbering, title, level: null, depth, sort_order: 0, source_file: file, position, blocks, children: [] };
}

export function buildOutlineByFolders(root, { diagnostics }) {
  const top = entriesOf(root);
  for (const file of top.files) {
    diagnostics.warning("folders.loose_file", `${file} is outside the numbered folders; not in the outline.`, { file });
  }

  const slugs = new Map();
  const uniqueSlug = (title) => {
    const base = slugify(title);
    const n = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const elements = [];
  const parts = new Map(); // part label -> part element
  let chapterNumber = 0;

  for (const dir of top.dirs) {
    const name = dir.replace(NUMBERED, "$2");
    const inner = entriesOf(path.join(root, dir));
    const position = { file: dir };

    // Front and back pages: titled from the file name. Consecutive files
    // with the same name are one section (05_Preface.md, 06_Preface.md ->
    // "Preface"); a Blank page joins the section before it (or after it,
    // if it comes first).
    if (FRONT.test(name) || BACK.test(name)) {
      const front = FRONT.test(name);
      const sections = [];
      let pendingBlank = [];
      for (const file of inner.files) {
        const [page] = readPages(root, dir, [file], diagnostics);
        const title = titleFromName(file.replace(/\.md$/, "")) || file;
        const heading = page.items.find((item) => item.kind === "heading");
        const consume = heading && key(heading.title) === key(title) ? heading : null;
        const blocks = blocksOf([page], consume);
        const last = sections.at(-1);
        if (/^blank$/i.test(title)) {
          if (last) last.blocks.push(...blocks);
          else pendingBlank.push(...blocks);
          continue;
        }
        if (last && key(last.title) === key(title)) {
          last.blocks.push(...blocks);
          continue;
        }
        sections.push(
          section({
            role: normalizeRole(title.replace(/\s+/g, "-")) ?? "section",
            title,
            depth: 1,
            file: page.file,
            position: { file: page.file },
            blocks: [...pendingBlank, ...blocks],
          })
        );
        pendingBlank = [];
      }
      for (const sub of inner.dirs) {
        diagnostics.warning("folders.nested_ignored", `${dir}/${sub} - folders inside ${front ? "front" : "back"} pages aren't read.`, { file: dir });
      }
      elements.push({
        role: front ? "front_matter" : "back_matter",
        number: null,
        slug: uniqueSlug(front ? "Front Matter" : "Back Matter"),
        title: front ? "Front Matter" : "Back Matter",
        level: null,
        sort_order: 0,
        position,
        partId: null,
        sections,
      });
      continue;
    }

    // Chapter, appendix or part.
    const partMatch = name.match(PART_LABEL);
    const partLabel = partMatch ? partMatch[1] : null;
    const folderTitle = titleFromName(partMatch ? partMatch[2] : name);
    const opening = readPages(root, dir, inner.files, diagnostics);
    const sectionPages = inner.dirs.map((sub) => ({ sub, pages: readPages(root, path.join(dir, sub), entriesOf(path.join(root, dir, sub)).files, diagnostics) }));
    const firstPages = opening.length ? opening : sectionPages[0]?.pages ?? [];
    const firstHeading = firstPages[0]?.items.find((item) => item.kind === "heading");
    const firstText = firstHeading ? headingText(firstHeading) : "";

    const appendixLabel = (name.match(/^Appendix_([A-Za-z0-9]+)(?:_|\.|$)/) ?? firstText.match(/^appendix\s+([a-z0-9]+)\b/i))?.[1]?.toUpperCase() ?? null;
    const isPart = /^part\b/i.test(firstText) && !inner.dirs.length;
    const heading = opening.length ? openingHeading(opening, name.replace(/_+/g, " ")) ?? openingHeading(opening, folderTitle) : null;

    let role;
    let number;
    let title;
    if (isPart) {
      role = "part";
      number = partLabel;
      title = folderTitle;
    } else if (appendixLabel) {
      role = "appendix";
      number = appendixLabel;
      const m = heading && headingText(heading).match(/^appendix\s+[a-z0-9]+\b[.:]?\s*(.+)$/i);
      title = m ? m[1].trim() : folderTitle.replace(/^Appendix\s+[A-Za-z0-9]+\.?\s*/i, "");
    } else {
      role = normalizeRole(folderTitle.replace(/\s+/g, "-")) ?? "chapter";
      number = role === "chapter" ? String(++chapterNumber) : null;
      title = (heading && stripChapterLabel(headingText(heading)).replace(/^\d+\.?\s+/, "")) || folderTitle;
    }

    const sections = [];
    const bodyBlocks = blocksOf(opening, heading);
    if (bodyBlocks.length || !sectionPages.length) {
      sections.push(section({ role: "body", title, depth: 1, file: opening[0]?.file ?? dir, position: opening[0] ? { file: opening[0].file } : position, blocks: bodyBlocks }));
    }
    for (const { sub, pages } of sectionPages) {
      const subTitle = titleFromName(sub);
      const subHeading = openingHeading(pages, subTitle);
      const nested = entriesOf(path.join(root, dir, sub)).dirs;
      for (const deeper of nested) {
        diagnostics.warning("folders.nested_ignored", `${dir}/${sub}/${deeper} - only one level of section folders is read.`, { file: path.join(dir, sub) });
      }
      const named = subHeading ? numberAndTitle(subHeading) : { numbering: null, title: null };
      sections.push(
        section({
          role: "section",
          numbering: named.numbering,
          title: named.title || subTitle,
          depth: 2,
          file: pages[0]?.file ?? path.join(dir, sub),
          position: pages[0] ? { file: pages[0].file } : { file: path.join(dir, sub) },
          blocks: blocksOf(pages, subHeading),
        })
      );
    }

    const element = { role, number, slug: uniqueSlug(title), title, level: null, sort_order: 0, position, partId: null, sections };
    if (role === "part") parts.set(partLabel, element);
    else if (partLabel && parts.has(partLabel)) element.partRef = parts.get(partLabel);
    elements.push(element);
  }

  if (!elements.length) {
    diagnostics.error("source.empty", "The numbered folders contain no Markdown pages.", {});
  } else {
    const sectionCount = elements.reduce((n, e) => n + e.sections.filter((s) => s.role === "section").length, 0);
    diagnostics.info("folders.used", `Structure from folders: ${elements.length} elements, ${sectionCount} section folders.`, {});
  }
  return elements;
}
