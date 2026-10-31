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
// Also accepted, as some organized books are laid out one file per section:
//
//   00_Front_Matter.md or Front_Matter/    front matter (a subfolder is one section)
//   Chapter_01_<Title>/                     a chapter
//     00_Introduction.md                      00_ files open the chapter
//     01_<Section_Title>.md                   every other NN_ file is a section,
//     02_<Section_Title>/                     every NN_ folder too: all its pages,
//       00_Overview.md, 01_<Sub>.md, ...        subsections included, in order
//   End_Matter/                             back matter; an NN_Appendix_X_ folder
//                                           or file in it is an appendix
//
// The folders are the structure; headings never create chapters or
// sections. A chapter's or section's own title heading (the first heading
// of its first page, when it matches the folder's title) gives the printed
// title and number and is consumed; every other heading stays in place as a
// subheading block.

const NUMBERED = /^(\d{2,3})_(.+)$/;
const CHAPTER_DIR = /^Chapter_(\d+)_(.+)$/i;
const FRONT = /^front_?(?:pages?|matter)$/i;
const BACK = /^(?:back|end)_?(?:pages?|matter)$/i;
const PART_LABEL = /^Part_([A-Za-z0-9]+)_(.+)$/;
const APPENDIX = /^Appendix_([A-Za-z0-9]+)(?:_|\.|$)/;

const bare = (name) => name.replace(/\.md$/, "").replace(NUMBERED, "$2");
const isMatter = (name) => FRONT.test(bare(name)) || BACK.test(bare(name));

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

function entriesOf(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return {
    files: entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort(byName),
    dirs: entries.filter((e) => e.isDirectory() && NUMBERED.test(e.name)).map((e) => e.name).sort(byName),
  };
}

// The book's top-level entries in order: numbered and Chapter_NN_ folders,
// unnumbered Front_Matter/End_Matter folders, and a loose front or back
// matter file (00_Front_Matter.md). Other loose files are returned apart.
function topEntries(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const listed = [];
  const loose = [];
  for (const e of entries) {
    if (e.isDirectory() && (NUMBERED.test(e.name) || CHAPTER_DIR.test(e.name) || isMatter(e.name))) listed.push({ name: e.name, dir: true });
    else if (e.isFile() && e.name.endsWith(".md")) {
      if (NUMBERED.test(e.name) && isMatter(e.name)) listed.push({ name: e.name, dir: false });
      else if (!/^readme\.md$/i.test(e.name)) loose.push(e.name);
    }
  }
  // Front matter, then numbered folders, then chapters, then back matter.
  const rank = (e) => (FRONT.test(bare(e.name)) ? 0 : BACK.test(bare(e.name)) ? 3 : CHAPTER_DIR.test(e.name) ? 2 : 1);
  listed.sort((a, b) => rank(a) - rank(b) || byName(a.name, b.name));
  return { listed, loose: loose.sort(byName) };
}

// Whether a markdown directory is organized into numbered folders holding pages.
export function hasBookFolders(dir) {
  return topEntries(dir).listed.some((e) => {
    if (!e.dir) return false;
    const inner = entriesOf(path.join(dir, e.name));
    return inner.files.length > 0 || inner.dirs.length > 0;
  });
}

// Every page under a folder, subfolders included, in numbered order.
function allPageFiles(root, relDir) {
  const { files, dirs } = entriesOf(path.join(root, relDir));
  const merged = [...files.map((f) => ({ name: f, dir: false })), ...dirs.map((d) => ({ name: d, dir: true }))].sort((a, b) => byName(a.name, b.name));
  return merged.flatMap((e) => (e.dir ? allPageFiles(root, path.join(relDir, e.name)) : [path.join(relDir, e.name)]));
}

const readFiles = (root, rels, diagnostics) => rels.map((rel) => ({ file: rel, items: parseFile(fs.readFileSync(path.join(root, rel), "utf8"), { file: rel, diagnostics }) }));

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

// A chapter folder's opening pages and its sections. Folders of pages
// (01_<Section>/p_page_0006.md): loose pages open the chapter, each subfolder
// is a section. One file per section (01_<Section>.md): 00_ files open it,
// every other NN_ file or folder is a section.
function chapterContent(root, relDir, diagnostics) {
  const inner = entriesOf(path.join(root, relDir));
  const titled = inner.files.some((f) => NUMBERED.test(f) && !/^0+_/.test(f));
  if (!titled) {
    return {
      opening: readPages(root, relDir, inner.files, diagnostics),
      units: inner.dirs.map((sub) => {
        const rel = path.join(relDir, sub);
        for (const deeper of entriesOf(path.join(root, rel)).dirs) {
          diagnostics.warning("folders.nested_ignored", `${rel}/${deeper} - only one level of section folders is read.`, { file: rel });
        }
        return { name: sub, rel, pages: readPages(root, rel, entriesOf(path.join(root, rel)).files, diagnostics) };
      }),
    };
  }
  const openingFiles = inner.files.filter((f) => !NUMBERED.test(f) || /^0+_/.test(f));
  const units = [
    ...inner.files.filter((f) => !openingFiles.includes(f)).map((f) => ({ name: f.replace(/\.md$/, ""), rel: path.join(relDir, f), files: [path.join(relDir, f)] })),
    ...inner.dirs.map((d) => ({ name: d, rel: path.join(relDir, d), files: allPageFiles(root, path.join(relDir, d)) })),
  ].sort((a, b) => byName(a.name, b.name));
  return {
    opening: readPages(root, relDir, openingFiles, diagnostics),
    units: units.map((u) => ({ name: u.name, rel: u.rel, pages: readFiles(root, u.files, diagnostics) })),
  };
}

export function buildOutlineByFolders(root, { diagnostics }) {
  const top = topEntries(root);
  for (const file of top.loose) {
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

  // A chapter, appendix or part from its folder name and content.
  function chapterElement(dir, name, { opening, units }) {
    const position = { file: dir };
    const chapterDir = name.match(CHAPTER_DIR);
    const partMatch = chapterDir ? null : name.match(PART_LABEL);
    const partLabel = partMatch ? partMatch[1] : null;
    const folderTitle = titleFromName(chapterDir ? chapterDir[2] : partMatch ? partMatch[2] : name);
    const firstPages = opening.length ? opening : units[0]?.pages ?? [];
    const firstHeading = firstPages[0]?.items.find((item) => item.kind === "heading");
    const firstText = firstHeading ? headingText(firstHeading) : "";

    const appendixLabel = (name.match(APPENDIX) ?? firstText.match(/^appendix\s+([a-z0-9]+)\b/i))?.[1]?.toUpperCase() ?? null;
    const isPart = /^part\b/i.test(firstText) && !units.length;
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
      role = chapterDir ? "chapter" : normalizeRole(folderTitle.replace(/\s+/g, "-")) ?? "chapter";
      if (role === "chapter") chapterNumber = chapterDir ? Number(chapterDir[1]) : chapterNumber + 1;
      number = role === "chapter" ? String(chapterNumber) : null;
      title = (heading && stripChapterLabel(headingText(heading)).replace(/^\d+\.?\s+/, "")) || folderTitle;
    }

    const sections = [];
    const bodyBlocks = blocksOf(opening, heading);
    if (bodyBlocks.length || !units.length) {
      sections.push(section({ role: "body", title, depth: 1, file: opening[0]?.file ?? dir, position: opening[0] ? { file: opening[0].file } : position, blocks: bodyBlocks }));
    }
    for (const { name: sub, rel, pages } of units) {
      const subTitle = titleFromName(sub);
      const subHeading = openingHeading(pages, subTitle);
      const named = subHeading ? numberAndTitle(subHeading) : { numbering: null, title: null };
      sections.push(
        section({
          role: "section",
          numbering: named.numbering,
          title: named.title || subTitle,
          depth: 2,
          file: pages[0]?.file ?? rel,
          position: pages[0] ? { file: pages[0].file } : { file: rel },
          blocks: blocksOf(pages, subHeading),
        })
      );
    }

    const element = { role, number, slug: uniqueSlug(title), title, level: null, sort_order: 0, position, partId: null, sections };
    if (role === "part") parts.set(partLabel, element);
    else if (partLabel && parts.has(partLabel)) element.partRef = parts.get(partLabel);
    return element;
  }

  for (const { name: entry, dir: isDir } of top.listed) {
    // Front and back pages: titled from the file name. Consecutive files
    // with the same name are one section (05_Preface.md, 06_Preface.md ->
    // "Preface"); a Blank page joins the section before it (or after it,
    // if it comes first). A subfolder is one section; in the back pages an
    // Appendix_X file or folder is an appendix of its own.
    if (isMatter(entry)) {
      const front = FRONT.test(bare(entry));
      const sections = [];
      const appendices = [];
      let pendingBlank = [];
      const inner = isDir ? entriesOf(path.join(root, entry)) : { files: [], dirs: [] };
      const items = isDir
        ? [...inner.files.map((f) => ({ name: f, dir: false })), ...inner.dirs.map((d) => ({ name: d, dir: true }))].sort((a, b) => byName(a.name, b.name))
        : [{ name: entry, dir: false, top: true }];
      for (const item of items) {
        const rel = item.top ? entry : path.join(entry, item.name);
        const itemName = item.name.replace(/\.md$/, "");
        if (!front && APPENDIX.test(bare(itemName))) {
          const content = item.dir ? chapterContent(root, rel, diagnostics) : { opening: readFiles(root, [rel], diagnostics), units: [] };
          appendices.push(chapterElement(rel, bare(itemName), content));
          continue;
        }
        const pages = readFiles(root, item.dir ? allPageFiles(root, rel) : [rel], diagnostics);
        const title = titleFromName(itemName) || item.name;
        const heading = pages[0]?.items.find((it) => it.kind === "heading");
        const consume = heading && key(heading.title) === key(title) ? heading : null;
        const blocks = blocksOf(pages, consume);
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
            file: pages[0]?.file ?? rel,
            position: { file: pages[0]?.file ?? rel },
            blocks: [...pendingBlank, ...blocks],
          })
        );
        pendingBlank = [];
      }
      elements.push(...appendices);
      if (sections.length) {
        elements.push({
          role: front ? "front_matter" : "back_matter",
          number: null,
          slug: uniqueSlug(front ? "Front Matter" : "Back Matter"),
          title: front ? "Front Matter" : "Back Matter",
          level: null,
          sort_order: 0,
          position: { file: entry },
          partId: null,
          sections,
        });
      }
      continue;
    }

    const name = CHAPTER_DIR.test(entry) ? entry : entry.replace(NUMBERED, "$2");
    elements.push(chapterElement(entry, name, chapterContent(root, entry, diagnostics)));
  }

  if (!elements.length) {
    diagnostics.error("source.empty", "The numbered folders contain no Markdown pages.", {});
  } else {
    const sectionCount = elements.reduce((n, e) => n + e.sections.filter((s) => s.role === "section").length, 0);
    diagnostics.info("folders.used", `Structure from folders: ${elements.length} elements, ${sectionCount} section folders.`, {});
  }
  return elements;
}
