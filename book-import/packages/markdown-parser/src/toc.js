import { astOf } from "./parseFile.js";
import { plainText } from "./text.js";

// Reads a book's own table of contents - the printed "Contents" page(s) of
// a PDF-converted book - into its top-level entries (chapters, parts,
// appendices, front/back matter). buildOutlineByToc.js then uses them as
// the chapter list instead of trusting the converter's heading levels.
//
// Detection: the first page with a heading that is exactly one of
// "Contents", "Table of Contents", "Contents at a Glance", "Brief Contents"
// or "Chapters" (any case, emphasis ignored). Entries are read from that
// page and the pages after it for as long as each one still has entries
// with page numbers (a detailed contents section can run 10+ pages), up to
// MAX_EXTRA_PAGES.
//
// Entry sources (from the AST, never from code blocks): table rows (cells
// joined, last cell = page number), headings, list items and paragraph
// lines ending in a page number. Only top-level entries are kept:
//   "Chapter 3: Title" / "Chapter-III: Title"   -> chapter 3
//   "3 Title" / "3. Title"                       -> chapter 3 (single number;
//                                                   "3.1 Title" is a sub-entry)
//   "Part II: Title"                             -> part
//   "Appendix A: Title" / "A Title" in bold      -> appendix
//   any other bold/heading entry ("Preface", "Index") -> front/back matter
// Plain, unnumbered, non-bold rows are sub-entries and ignored.

export const TOC_HEADING_RE = /^(?:table of contents|contents(?: at a glance)?|brief contents|chapters)$/i;
const MAX_EXTRA_PAGES = 40;

const ROMAN = /^[ivxlcdm]+$/i;
// Trailing page number, after optional dot leaders / dashes, or in
// parentheses ("Preface (xi)").
const TRAILING_PAGE_RE = /^(.*?\S)[\s.·…•_—–-]*\s+\(?(\d{1,4}|[ivxlcdm]{1,7})\)?$/i;

export function cleanTocText(text) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*[-–•]\s+/, "")
    .replace(/[■□▪●•◆*_]+/g, " ")
    .replace(/(?:\s*\.\s*){3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function romanToInt(s) {
  const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  const chars = s.toLowerCase();
  for (let i = 0; i < chars.length; i++) {
    const v = values[chars[i]];
    total += v < (values[chars[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

function splitPage(text) {
  const match = text.match(TRAILING_PAGE_RE);
  if (!match) return { title: text, printed: null };
  const [, title, page] = match;
  // A lone trailing roman-looking word ("Chapter I", "Part II") is part of
  // the title, not a page number.
  if (ROMAN.test(page) && /\b(chapter|part|appendix|volume)$/i.test(title.trim())) return { title: text, printed: null };
  return ROMAN.test(page)
    ? { title, printed: { roman: true, value: romanToInt(page), raw: page } }
    : { title, printed: { roman: false, value: Number(page), raw: page } };
}

const hasEmphasis = (node) =>
  node.type === "strong" ||
  (node.type === "html" && /<(b|strong)\b/i.test(node.value)) ||
  (node.children ?? []).some(hasEmphasis);

function candidate(text, { emphasized }) {
  const cleaned = cleanTocText(text);
  if (!cleaned) return null;
  const { title, printed } = splitPage(cleaned);
  return { raw: cleaned, title: title.trim(), printed, emphasized };
}

// A paragraph's inline children split into lines at soft/hard breaks, so
// emphasis is judged per line (a bold chapter line doesn't make the
// sub-entry lines of the same paragraph bold).
function paragraphLines(paragraph) {
  const lines = [[]];
  for (const child of paragraph.children) {
    if (child.type === "break") {
      lines.push([]);
    } else if (child.type === "text" && child.value.includes("\n")) {
      child.value.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ type: "text", value: part });
      });
    } else {
      lines[lines.length - 1].push(child);
    }
  }
  return lines.filter((line) => line.length);
}

// Candidate entries of one page, in order.
function pageCandidates(items) {
  const out = [];
  let pendingNumber = null;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const next = items[index + 1];
    if (item.kind === "heading") {
      if (!TOC_HEADING_RE.test(cleanTocText(item.title))) {
        const text = item.numbering ? `${item.numbering} ${item.title}` : item.title;
        const c = candidate(pendingNumber && !item.numbering ? `${pendingNumber} ${text}` : text, { emphasized: true });
        if (c) out.push({ ...c, fromHeading: true });
      }
      pendingNumber = null;
      continue;
    }
    const node = astOf(item);
    if (!node) continue;
    if (node.type === "table") {
      for (const row of node.children) {
        const cells = row.children.map((cell) => ({ text: cleanTocText(plainText(cell)), emphasized: hasEmphasis(cell) }));
        const filled = cells.filter((c) => c.text);
        if (!filled.length) continue;
        const c = candidate(filled.map((x) => x.text).join(" "), { emphasized: filled.some((x) => x.emphasized) });
        if (c) out.push(c);
      }
    } else if (node.type === "list") {
      // An ordered list's numbers aren't in the item text ("1. **Title** — 2"
      // is item 1 with text "Title — 2"), so they're put back. Nested lists
      // are sub-entries and not read.
      node.children.forEach((li, index) => {
        const first = li.children[0];
        if (first?.type !== "paragraph") return;
        const number = node.ordered ? `${(node.start ?? 1) + index} ` : "";
        const c = candidate(number + plainText(first), { emphasized: hasEmphasis(first) });
        if (c?.printed) out.push(c);
      });
    } else if (node.type === "paragraph") {
      const lines = paragraphLines(node);
      // A chapter number alone on its line, with the title as the next
      // heading ("**1**" then "## Concurrency and ...").
      if (lines.length === 1 && /^\d{1,3}$/.test(cleanTocText(plainText({ children: lines[0] }))) && next?.kind === "heading") {
        pendingNumber = cleanTocText(plainText({ children: lines[0] }));
        continue;
      }
      for (const line of lines) {
        const c = candidate(plainText({ children: line }), { emphasized: line.some(hasEmphasis) });
        if (c?.printed) out.push(c);
      }
    }
  }
  return out;
}

const ROMAN_OR_INT = "(\\d{1,3}|[ivxlcdm]{1,6})";
const CHAPTER_RE = new RegExp(`^chap(?:ter|\\.)?[\\s-]*${ROMAN_OR_INT}\\b[\\s:.–—-]*(.*)$`, "i");
const PART_RE = new RegExp(`^part[\\s-]+(${ROMAN_OR_INT.slice(1, -1)}|one|two|three|four|five|six|seven|eight|nine|ten)\\b[\\s:.–—-]*(.*)$`, "i");
const APPENDIX_RE = /^appendix[\s-]+([A-Z0-9]{1,3})\b[\s:.–—-]*(.*)$/i;
// "3 Title" - but not "62 1.7.1 Title" (a page number glued to a sub-entry).
const NUMBERED_RE = /^(\d{1,3})\.?\s+(?!\d+\.\d)([\p{L}\p{N}].*)$/u;
const LETTERED_RE = /^([A-Z])\.?\s+(\p{Lu}.*)$/u;

function toNumber(raw) {
  return ROMAN.test(raw) ? String(romanToInt(raw)) : String(Number(raw));
}

// Top-level classification of one candidate, or null for a sub-entry.
function classify(c, { afterChapters }) {
  let m;
  if ((m = c.title.match(CHAPTER_RE))) return { kind: "chapter", number: toNumber(m[1]), title: m[2].trim() };
  if ((m = c.title.match(PART_RE))) return { kind: "part", number: m[1], title: m[2].trim() };
  if ((m = c.title.match(APPENDIX_RE))) return { kind: "appendix", number: m[1].toUpperCase(), title: m[2].trim() };
  if ((m = c.title.match(NUMBERED_RE)) && (c.emphasized || c.printed)) return { kind: "chapter", number: m[1], title: m[2].trim() };
  if (afterChapters && c.emphasized && (m = c.title.match(LETTERED_RE))) return { kind: "appendix", number: m[1], title: m[2].trim() };
  // Starts with a number but isn't a chapter ("1.1 Sub-entry", "1 – variables").
  if (/^\d/.test(c.title)) return c.emphasized ? { kind: "ignored" } : null;
  if (c.emphasized) return { kind: "matter", number: null, title: c.title };
  return null;
}

/**
 * Finds the contents page(s) among a book's parsed pages and returns
 * { tocPageIndex, lastTocPageIndex, entries, ignored } or null when there is none.
 *   pages: [{ file, page, items }] in reading order
 * entries: [{ kind: chapter|part|appendix|matter, number, title, printed, position }]
 */
export function readTableOfContents(pages) {
  const tocPageIndex = pages.findIndex((p) =>
    p.items.some((item) => item.kind === "heading" && TOC_HEADING_RE.test(cleanTocText(item.title)))
  );
  if (tocPageIndex === -1) return null;

  const entries = [];
  const ignored = [];
  const seen = new Set();
  let lastChapter = 0;
  let lastTocPageIndex = tocPageIndex;
  let afterChapters = false;
  for (let i = tocPageIndex; i < pages.length && i <= tocPageIndex + MAX_EXTRA_PAGES; i++) {
    const candidates = pageCandidates(pages[i].items);
    const found = candidates.filter((c) => c.printed).length;
    if (i > tocPageIndex && !found) break;
    lastTocPageIndex = i;
    for (const c of candidates) {
      const entry = classify(c, { afterChapters });
      if (!entry || !entry.title && entry.kind === "matter") continue;
      if (entry.kind === "ignored") {
        ignored.push({ raw: c.raw, file: pages[i].file });
        continue;
      }
      if (entry.kind === "chapter") {
        // Chapter numbers only go up; a lower one is a sub-entry or noise
        // ("2 – references" under chapter 8).
        const n = Number(entry.number);
        if (Number.isFinite(n) && n <= lastChapter) {
          ignored.push({ raw: c.raw, file: pages[i].file });
          continue;
        }
        if (Number.isFinite(n)) lastChapter = n;
        afterChapters = true;
      }
      // "Contents at a Glance" and a detailed "Contents" list the same
      // chapters twice - first mention wins.
      const key = entry.number ? `${entry.kind}:${entry.number}` : `${entry.kind}:${entry.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...entry, printed: c.printed, raw: c.raw, file: pages[i].file });
    }
  }
  return { tocPageIndex, lastTocPageIndex, entries, ignored };
}
