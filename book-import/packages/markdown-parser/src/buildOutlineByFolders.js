import fs from "node:fs";
import path from "node:path";
import { parseFile } from "./parseFile.js";
import { normalizeRole, ROLES } from "./roles.js";
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
// Unnumbered folders named for a part of a book (Foreword/, Preface/,
// Chapters/ or Contents/, Epilogue/, Index/, ...) are front or back matter,
// in the usual book order; a Front_Matter/ or Back_Matter/ folder of page
// files is one section. A 00_ folder is an unnumbered introduction.
//
// The folders are the structure; headings never create chapters or
// sections. A chapter's or section's own title heading (the first heading
// of its first page, when it matches the folder's title) gives the printed
// title and number and is consumed; every other heading stays in place as a
// subheading block.

const NUMBERED = /^(\d{2,3})_(.+)$/;
const CHAPTER_DIR = /^Chapter_(\d+)_(.+)$/i;
const FRONT = /^front_?(?:pages?|matter)$/i;
const BACK = /^(?:back|end|last)_?(?:pages?|matter)$/i;
const PART_LABEL = /^Part_([A-Za-z0-9]+)_(.+)$/;
const APPENDIX = /^Appendix_([A-Za-z0-9]+)(?:_|\.|$)/;

const bare = (name) => name.replace(/\.md$/, "").replace(NUMBERED, "$2");
const isMatter = (name) => FRONT.test(bare(name)) || BACK.test(bare(name));
const ROLE_ORDER = Object.keys(ROLES);

// The front/back matter role an unnumbered folder's name gives:
// Preface -> preface, Chapters -> toc, Index_Symbols -> index.
function folderRole(name) {
  if (NUMBERED.test(name) || CHAPTER_DIR.test(name)) return null;
  if (FRONT.test(name)) return "front_matter";
  if (BACK.test(name)) return "back_matter";
  const words = name.toLowerCase().split(/[_\s-]+/).filter(Boolean);
  if (/^(chapters|contents|table_of_contents)$/.test(words.join("_"))) return "toc";
  const role = normalizeRole(words.join("-")) ?? normalizeRole(words[0]);
  return role && ROLES[role] !== "main" ? role : null;
}
// Which matter an entry is: "front", "back" or null.
function matterOf(name) {
  if (isMatter(name)) return FRONT.test(bare(name)) ? "front" : "back";
  const role = folderRole(name);
  return role ? ROLES[role] : null;
}

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
    if (e.isDirectory() && (NUMBERED.test(e.name) || CHAPTER_DIR.test(e.name) || isMatter(e.name) || folderRole(e.name))) listed.push({ name: e.name, dir: true });
    else if (e.isFile() && e.name.endsWith(".md")) {
      if (NUMBERED.test(e.name) && isMatter(e.name)) listed.push({ name: e.name, dir: false });
      else if (!/^readme\.md$/i.test(e.name)) loose.push(e.name);
    }
  }
  // Front matter, then numbered folders, then chapters, then back matter;
  // unnumbered matter folders in the usual book order (Contents, Foreword,
  // Preface; Epilogue, Index).
  const rank = (e) => {
    const matter = matterOf(e.name);
    return matter === "front" ? 0 : matter === "back" ? 3 : CHAPTER_DIR.test(e.name) ? 2 : 1;
  };
  const roleRank = (e) => (NUMBERED.test(e.name) ? -1 : ROLE_ORDER.indexOf(folderRole(e.name) ?? ""));
  listed.sort((a, b) => rank(a) - rank(b) || roleRank(a) - roleRank(b) || byName(a.name, b.name));
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

// A heading that is only a chapter's label: "Chapter 4", "CHAPTER 4", "6".
const CHAPTER_LABEL = /^(?:chap(?:ter|\.)?\s+)?(\d+)\.?$/i;

// The chapter's title heading among the first headings of its opening pages,
// with the "Chapter 4" label heading just before it, if any. A part banner
// may come first ("Part I Day 1: Morning", then "Chapter 3", "Welcome to Day 1").
function chapterHeadings(opening, names) {
  const firsts = opening.flatMap((p) => p.items.filter((item) => item.kind === "heading")).slice(0, 4);
  for (let i = 0; i < firsts.length; i++) {
    const title = names.map((n) => openingHeading(opening, n, firsts[i])).find(Boolean);
    if (!title) continue;
    const label = i > 0 && CHAPTER_LABEL.test(headingText(firsts[i - 1])) ? firsts[i - 1] : null;
    return { title, label };
  }
  return { title: null, label: null };
}

// "CHAPTER 1 Hello Transformers" -> "Hello Transformers" (the number is kept separately).
const stripChapterLabel = (text) => text.replace(/^chap(?:ter|\.)?\s+[0-9ivxlc]+\b[.:]?\s*/i, "");

// The title heading a folder opens with, if it names the folder: "1 Understanding
// Large Language Models" for 02_Understanding_Large_Language_Models,
// "1.1 What is an LLM?" for 01_What_is_an_LLM, "Appendix A. Introduction to
// PyTorch" for 09_Appendix_A_Introduction_to_PyTorch.
function openingHeading(pages, folderTitle, first = pages[0]?.items.find((item) => item.kind === "heading")) {
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
  const consumed = consume instanceof Set ? consume : new Set([consume]);
  const blocks = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (consumed.has(item)) continue;
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

// Parts the book's own contents page lists ("Part I. Data Structures",
// "PART II Functions as Objects"): part title key -> numeral. The contents
// page is a front matter file or folder named Contents, Table_of_Contents or
// Chapters.
const CONTENTS_NAME = /^(contents|table_of_contents|chapters|toc)$/i;
const PART_LINE = /^(?:#+\s*)?[*_]*part\s+([ivxlc]+|\d+)[*_]*[.,:]?\s+[*_]*(.+?)[*_\s]*$/i;
function partsListed(root, listed) {
  const files = [];
  const visit = (rel, inContents) => {
    const full = path.join(root, rel);
    if (fs.statSync(full).isFile()) {
      if (inContents || CONTENTS_NAME.test(bare(path.basename(rel)))) files.push(full);
      return;
    }
    for (const e of fs.readdirSync(full)) {
      if (e === "images") continue;
      const child = path.join(rel, e);
      if (fs.statSync(path.join(root, child)).isDirectory()) visit(child, inContents || CONTENTS_NAME.test(bare(e)));
      else if (e.endsWith(".md")) visit(child, inContents);
    }
  };
  for (const e of listed) if (matterOf(e.name) === "front") visit(e.name, CONTENTS_NAME.test(bare(e.name)));
  const found = new Map();
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.trim().match(PART_LINE);
      if (m) found.set(key(m[2].replace(/\s+\d+$/, "")), m[1].toUpperCase());
    }
  }
  return found;
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
  const listedParts = partsListed(root, top.listed);
  let currentPart = null; // a part found from the contents page: chapters after it belong to it
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
    // A part: a Part_ folder (or one titled by its part heading) holding just the part's page.
    const listedPart = !units.length && !chapterDir ? listedParts.get(key(folderTitle)) : undefined;
    const isPart = listedPart !== undefined || (/^part\b/i.test(firstText) && !units.length && (Boolean(partLabel) || key(firstText).includes(key(folderTitle))));
    const { title: heading, label } = opening.length ? chapterHeadings(opening, [name.replace(/_+/g, " "), folderTitle, folderTitle.replace(/^Appendix\s+[A-Za-z0-9]+\.?\s+/i, "")]) : { title: null, label: null };
    const introduction = /^0+_/.test(dir) && !chapterDir;

    let role;
    let number;
    let title;
    if (isPart) {
      role = "part";
      number = partLabel ?? listedPart ?? firstText.match(/^part\s+([ivxlc]+|\d+)\b/i)?.[1]?.toUpperCase() ?? null;
      title = folderTitle;
    } else if (appendixLabel) {
      role = "appendix";
      number = appendixLabel;
      const m = heading && headingText(heading).match(/^appendix\s+[a-z0-9]+\b[.:]?\s*(.+)$/i);
      title = m ? m[1].trim() : heading ? headingText(heading) : folderTitle.replace(/^Appendix\s+[A-Za-z0-9]+\.?\s*/i, "");
    } else {
      role = chapterDir || label ? "chapter" : introduction ? "introduction" : normalizeRole(folderTitle.replace(/\s+/g, "-")) ?? "chapter";
      // The book's own number - "Chapter 4" label, "CHAPTER 1 ..." or "1 ..." title,
      // Chapter_04_ folder - else the next one.
      const printed = (label && headingText(label).match(CHAPTER_LABEL)[1]) ?? (heading && headingText(heading).match(/^(?:chap(?:ter|\.)?\s+)?(\d+)\b/i)?.[1]) ?? chapterDir?.[1];
      if (role === "chapter") chapterNumber = printed ? Number(printed) : chapterNumber + 1;
      number = role === "chapter" ? String(chapterNumber) : null;
      title = (heading && stripChapterLabel(headingText(heading)).replace(/^\d+\.?\s+/, "")) || folderTitle;
    }

    const sections = [];
    const bodyBlocks = blocksOf(opening, new Set([heading, label]));
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
    if (role === "part" && partLabel) parts.set(partLabel, element);
    else if (role === "part") currentPart = element;
    else if (role === "chapter" && !partLabel && currentPart) element.partRef = currentPart;
    else if (partLabel && parts.has(partLabel)) element.partRef = parts.get(partLabel);
    return element;
  }

  // Front and back matter: one element each, gathering every front (back)
  // folder or file in order.
  const matter = { front: null, back: null };
  const appendices = [];
  const matterElement = (division, entry) => {
    if (!matter[division]) {
      const title = division === "front" ? "Front Matter" : "Back Matter";
      matter[division] = { role: `${division}_matter`, number: null, slug: uniqueSlug(title), title, level: null, sort_order: 0, position: { file: entry }, partId: null, sections: [] };
      if (division === "front") elements.push(matter.front);
    }
    return matter[division];
  };

  for (const { name: entry, dir: isDir } of top.listed) {
    const division = matterOf(entry);
    if (!division) {
      const name = CHAPTER_DIR.test(entry) ? entry : entry.replace(NUMBERED, "$2");
      elements.push(chapterElement(entry, name, chapterContent(root, entry, diagnostics)));
      continue;
    }
    // Front and back pages: titled from the file name. Consecutive files
    // with the same name are one section (05_Preface.md, 06_Preface.md ->
    // "Preface"); a Blank page joins the section before it (or after it,
    // if it comes first). A subfolder is one section, and so are a
    // Front_Matter folder's page files; in the back pages an Appendix_X file
    // or folder is an appendix of its own. A folder named for its role
    // (Preface/, Index/) is one section.
    const front = division === "front";
    const { sections } = matterElement(division, entry);
    let pendingBlank = [];
    const folderTitle = titleFromName(bare(entry)).replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2");
    let items;
    if (!isDir) items = [{ name: entry, dir: false, top: true }];
    else if (!isMatter(entry)) items = [{ name: entry, dir: true, top: true, title: folderTitle, role: folderRole(entry) }];
    else {
      // Every subfolder counts here, numbered or not (00_FrontPages/Chapters/).
      const inner = entriesOf(path.join(root, entry));
      const subdirs = fs.readdirSync(path.join(root, entry), { withFileTypes: true }).filter((e) => e.isDirectory() && allPageFiles(root, path.join(entry, e.name)).length).map((e) => e.name);
      items = [...inner.files.map((f) => ({ name: f, dir: false, ...(NUMBERED.test(f) ? {} : { title: folderTitle }) })), ...subdirs.map((d) => ({ name: d, dir: true, ...(NUMBERED.test(d) ? {} : { role: folderRole(d) ?? undefined }) }))];
      // An unnumbered subfolder sorts where its pages fall among the page files.
      const sortName = (it) => (it.dir && !NUMBERED.test(it.name) ? path.basename(allPageFiles(root, path.join(entry, it.name))[0]) : it.name);
      items.sort((x, y) => byName(sortName(x), sortName(y)));
    }
    for (const item of items) {
      const rel = item.top ? entry : path.join(entry, item.name);
      const itemName = item.name.replace(/\.md$/, "");
      if (!front && !item.top && APPENDIX.test(bare(itemName))) {
        const content = item.dir ? chapterContent(root, rel, diagnostics) : { opening: readFiles(root, [rel], diagnostics), units: [] };
        appendices.push(chapterElement(rel, bare(itemName), content));
        continue;
      }
      const pages = readFiles(root, item.dir ? allPageFiles(root, rel) : [rel], diagnostics);
      // 007_ConventionsUsed.md -> "Conventions Used"
      const title = item.title ?? (titleFromName(itemName).replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2") || item.name);
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
          role: item.role ?? normalizeRole(title.replace(/\s+/g, "-")) ?? "section",
          title,
          depth: 1,
          file: pages[0]?.file ?? rel,
          position: { file: pages[0]?.file ?? rel },
          blocks: [...pendingBlank, ...blocks],
        })
      );
      pendingBlank = [];
    }
  }
  elements.push(...appendices);
  if (matter.back?.sections.length) elements.push(matter.back);
  if (matter.front && !matter.front.sections.length) elements.splice(elements.indexOf(matter.front), 1);

  if (!elements.length) {
    diagnostics.error("source.empty", "The numbered folders contain no Markdown pages.", {});
  } else {
    const sectionCount = elements.reduce((n, e) => n + e.sections.filter((s) => s.role === "section").length, 0);
    diagnostics.info("folders.used", `Structure from folders: ${elements.length} elements, ${sectionCount} section folders.`, {});
  }
  return elements;
}
