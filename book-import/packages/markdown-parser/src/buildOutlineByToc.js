import { readTableOfContents, cleanTocText } from "./toc.js";
import { slugify } from "./buildOutlineByHeadings.js";

// Stage 3 - book structure from the book's own table of contents (strategy
// "toc"). Used for a Markdown directory whose pages include a contents page
// (see toc.js); the converter's heading levels are not used to decide what
// a chapter is.
//
// 1. Read the top-level entries of the contents page(s).
// 2. Place each entry in the page sequence:
//    - Anchors: headings exactly matching an entry's title ("Chapter 3",
//      or the title itself), keeping the longest chain that is in order in
//      both the contents and the book - so an out-of-place match ("About
//      the Author" listed first, printed last) can't derail the rest.
//    - Other entries: a title match near printed page + the nearest
//      anchor's page offset (±2 pages), else the top of that page, else a
//      title match before the next anchor. The offset is local because it
//      drifts through a PDF (missing blank pages).
//    Unplaceable entries are reported and skipped; their pages stay with
//    the previous element.
// 3. Everything before the first placed entry (cover, copyright, the
//    contents pages themselves) is a "Front Matter" element. Each entry's
//    element runs from its start to the next entry's start. Its opening
//    title heading(s) are consumed; other headings become sections - flat,
//    except dotted numbering ("1.1" > "1.1.2"), which nests.
//
// Returns null (caller falls back to "headings") when there's no contents
// page or fewer than two entries could be placed.

const SEARCH_WINDOW = 2;

function pageNumberOf(file, index) {
  const match = file?.match(/_page_(\d+)\.md$/);
  return match ? Number(match[1]) : index + 1;
}

function norm(text) {
  return cleanTocText(text)
    .toLowerCase()
    .replace(/^chap(?:ter|\.)?[\s-]*(\d+|[ivxlcdm]+)\b[\s:.–—-]*/, "")
    .replace(/^(\d{1,3})\.?\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function headingText(item) {
  return item.numbering ? `${item.numbering} ${item.title}` : item.title;
}

function isChapterMarker(entry, text) {
  if (!entry.number) return false;
  const m = cleanTocText(text).match(/^(chap(?:ter|\.)?|part|appendix)[\s-]*([0-9]+|[ivxlcdm]+|[a-z])\b/i);
  if (!m) return false;
  const value = /^\d+$/.test(m[2]) ? String(Number(m[2])) : m[2];
  const roman = /^[ivxlcdm]+$/i.test(value) ? romanValue(value) : null;
  return String(entry.number).toLowerCase() === value.toLowerCase() || (roman !== null && String(roman) === String(entry.number));
}

function romanValue(s) {
  const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  const chars = s.toLowerCase();
  for (let i = 0; i < chars.length; i++) {
    const v = values[chars[i]];
    total += v < (values[chars[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

// 2 = exact (same title, or "Chapter N" for chapter N), 1 = one title is a
// prefix of the other, 0 = no match.
function matchStrength(entry, item) {
  const text = headingText(item);
  if (isChapterMarker(entry, text)) return 2;
  const en = norm(entry.title);
  const hn = norm(text);
  if (!en || !hn) return 0;
  if (hn === en) return 2;
  return (en.length >= 6 && hn.startsWith(en)) || (hn.length >= 6 && en.startsWith(hn)) ? 1 : 0;
}

const titleMatches = (entry, item) => matchStrength(entry, item) > 0;

// Longest chain of (entry, heading) exact-match pairs that is in order both
// in the contents and in the book, at most one heading per entry. O(n²) over
// candidate pairs - a few hundred at most.
function anchorChain(pairs) {
  const len = pairs.map(() => 1);
  const prev = pairs.map(() => -1);
  for (let j = 0; j < pairs.length; j++) {
    for (let i = 0; i < j; i++) {
      if (pairs[i].k < pairs[j].k && pairs[i].pos < pairs[j].pos && len[i] + 1 > len[j]) {
        len[j] = len[i] + 1;
        prev[j] = i;
      }
    }
  }
  let end = -1;
  for (let j = 0; j < pairs.length; j++) if (end === -1 || len[j] > len[end]) end = j;
  const chain = [];
  for (let j = end; j !== -1; j = prev[j]) chain.unshift(pairs[j]);
  return chain;
}

export function buildOutlineByToc(pages, { diagnostics }) {
  const toc = readTableOfContents(pages);
  if (!toc) return null;

  for (const { raw, file } of toc.ignored) {
    diagnostics.info("toc.ignored_entry", `Contents line "${raw}" numbers a chapter out of sequence; ignored.`, { file });
  }
  const pageNos = pages.map((p, i) => pageNumberOf(p.file, i));
  const pageIndexByNo = new Map(pageNos.map((n, i) => [n, i]));
  const firstBody = toc.lastTocPageIndex + 1;
  const headings = [];
  for (let pi = firstBody; pi < pages.length; pi++) {
    pages[pi].items.forEach((item, ii) => {
      if (item.kind === "heading") headings.push({ pi, ii, item });
    });
  }
  const after = (h, cursor) => h.pi > cursor.pi || (h.pi === cursor.pi && h.ii >= cursor.ii);

  // Anchors: exact title matches that are consistent with the contents
  // order. The PDF's page offset drifts (blank pages between chapters are
  // often missing), so there is no single offset; each anchor gives the
  // local one.
  const pairs = [];
  toc.entries.forEach((entry, k) => {
    headings.forEach((h, pos) => {
      if (matchStrength(entry, h.item) === 2) pairs.push({ k, pos, h });
    });
  });
  const anchors = new Map(anchorChain(pairs).map((a) => [a.k, a.h]));

  const localOffset = (k) => {
    for (let j = k - 1; j >= 0; j--) {
      const e = toc.entries[j];
      if (anchors.has(j) && e.printed && !e.printed.roman) return pageNos[anchors.get(j).pi] - e.printed.value;
    }
    for (let j = k + 1; j < toc.entries.length; j++) {
      const e = toc.entries[j];
      if (anchors.has(j) && e.printed && !e.printed.roman) return pageNos[anchors.get(j).pi] - e.printed.value;
    }
    return null;
  };
  const nextAnchorPi = (k) => {
    for (let j = k + 1; j < toc.entries.length; j++) if (anchors.has(j)) return anchors.get(j).pi;
    return pages.length;
  };

  // Placement, in contents order: anchor; else a (prefix) title match near
  // printed + local offset; else the top of that predicted page; else a
  // title match anywhere before the next anchor.
  let cursor = { pi: firstBody, ii: 0 };
  const placed = [];
  const unplaced = [];
  toc.entries.forEach((entry, k) => {
    let start = null;
    let how = null;
    const limit = nextAnchorPi(k);
    const inRange = (h) => after(h, cursor) && h.pi <= limit;
    if (anchors.has(k) && after(anchors.get(k), cursor)) {
      const a = anchors.get(k);
      [start, how] = [{ pi: a.pi, ii: a.ii }, "title"];
    } else {
      const offset = entry.printed && !entry.printed.roman ? localOffset(k) : null;
      const predicted = offset === null ? null : pageIndexByNo.get(entry.printed.value + offset) ?? null;
      const near = (h) => predicted === null || Math.abs(h.pi - predicted) <= SEARCH_WINDOW;
      const hit = headings.find((h) => inRange(h) && near(h) && titleMatches(entry, h.item));
      if (hit) [start, how] = [{ pi: hit.pi, ii: hit.ii }, "title"];
      else if (predicted !== null && predicted > cursor.pi && predicted < limit) [start, how] = [{ pi: predicted, ii: 0 }, "page"];
    }
    if (!start) {
      const offset = entry.printed && !entry.printed.roman ? localOffset(k) : null;
      if (offset !== null && entry.printed.value + offset > pageNos[pageNos.length - 1]) {
        diagnostics.warning(
          "toc.beyond_source",
          `Contents entry "${entry.raw}" should be around page ${entry.printed.value + offset}, past the last page file (${pages[pages.length - 1].file}) - the conversion looks incomplete.`,
          { file: entry.file }
        );
        return;
      }
      unplaced.push(entry);
      return;
    }
    if (how === "page") {
      diagnostics.info("toc.placed_by_page", `"${entry.raw}" has no matching heading; placed at the top of ${pages[start.pi].file} from its page number.`, {
        file: pages[start.pi].file,
      });
    }
    placed.push({ entry, start, how });
    cursor = { pi: start.pi, ii: start.ii + 1 };
  });

  // Second chance, out of contents order: an entry whose title matches
  // exactly one heading nobody else starts at (a PDF that prints "About the
  // Author" at the back although the contents list it first).
  const taken = new Set(placed.map((p) => `${p.start.pi}:${p.start.ii}`));
  for (const entry of unplaced) {
    const exact = headings.filter((h) => matchStrength(entry, h.item) === 2 && !taken.has(`${h.pi}:${h.ii}`));
    if (exact.length === 1) {
      const [h] = exact;
      placed.push({ entry, start: { pi: h.pi, ii: h.ii }, how: "title" });
      taken.add(`${h.pi}:${h.ii}`);
      diagnostics.info("toc.out_of_order", `"${entry.raw}" is listed out of book order in the contents; placed at its heading in ${pages[h.pi].file}.`, {
        file: pages[h.pi].file,
      });
      continue;
    }
    diagnostics.warning(
      "toc.unplaced_entry",
      `Contents entry "${entry.raw}" couldn't be located in the pages; its content stays in the previous element.`,
      { file: entry.file }
    );
  }
  placed.sort((a, b) => a.start.pi - b.start.pi || a.start.ii - b.start.ii);

  if (placed.filter((p) => p.entry.kind !== "matter").length < 2) {
    diagnostics.info("toc.insufficient", `Contents page ${pages[toc.tocPageIndex].file} found but fewer than two chapters could be placed; using headings instead.`, {
      file: pages[toc.tocPageIndex].file,
    });
    return null;
  }

  const numbers = toc.entries.filter((e) => e.kind === "chapter").map((e) => Number(e.number)).filter(Number.isFinite);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > numbers[i - 1] + 1) {
      diagnostics.info("toc.chapter_gap", `Contents jumps from chapter ${numbers[i - 1]} to ${numbers[i]}; the missing chapters' pages stay with chapter ${numbers[i - 1]}.`, {
        file: pages[toc.tocPageIndex].file,
      });
    }
  }
  diagnostics.info(
    "toc.used",
    `Chapters from the contents in ${pages[toc.tocPageIndex].file}` +
      (toc.lastTocPageIndex > toc.tocPageIndex ? `–${pages[toc.lastTocPageIndex].file}` : "") +
      `: ${placed.length} of ${toc.entries.length} entries placed ` +
      `(${placed.filter((p) => p.how === "title").length} at their title heading, ${placed.filter((p) => p.how === "page").length} by page number).`,
    { file: pages[toc.tocPageIndex].file }
  );

  return buildElements(pages, placed);
}

function buildElements(pages, placed) {
  const firstChapterIndex = placed.findIndex((p) => p.entry.kind !== "matter");
  const slugs = new Map();
  const uniqueSlug = (title) => {
    const base = slugify(title);
    const n = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const elements = [];
  const boundaries = [{ pi: 0, ii: 0, entry: null }, ...placed.map((p) => ({ ...p.start, entry: p.entry }))];
  let currentPart = null;

  boundaries.forEach((from, b) => {
    const to = boundaries[b + 1] ?? { pi: pages.length, ii: 0 };
    const items = [];
    for (let pi = from.pi; pi < pages.length && (pi < to.pi || (pi === to.pi && to.ii > 0)); pi++) {
      const list = pages[pi].items;
      const startIi = pi === from.pi ? from.ii : 0;
      const endIi = pi === to.pi ? to.ii : list.length;
      for (let ii = startIi; ii < endIi; ii++) items.push({ item: list[ii], file: pages[pi].file });
    }

    const entry = from.entry;
    if (!entry) {
      if (!items.length) return;
      elements.push(element({ role: "front_matter", number: null, title: "Front Matter", slug: uniqueSlug("Front Matter") }, items, null));
      return;
    }

    const k = placed.findIndex((p) => p.entry === entry);
    const role =
      entry.kind === "matter" ? (k < firstChapterIndex ? "front_matter" : "back_matter") : entry.kind;
    const title = entry.title || (entry.kind === "chapter" ? `Chapter ${entry.number}` : entry.raw);
    const el = element({ role, number: entry.number, title, slug: uniqueSlug(title) }, items, entry);
    if (role === "part") currentPart = el;
    else if (role === "back_matter" || role === "front_matter") currentPart = null;
    else if (currentPart) el.partRef = currentPart;
    elements.push(el);
  });
  return elements;
}

// One top-level element from its items: the opening title heading(s) are
// consumed, a body section takes the content before the first remaining
// heading, and remaining headings become sections.
function element({ role, number, title, slug }, items, entry) {
  const first = items[0];
  const el = {
    role,
    number,
    slug,
    title,
    level: null,
    sort_order: 0,
    position: first?.item.position ?? (first ? { file: first.file } : undefined),
    partId: null,
    sections: [],
  };
  const body = { role: "body", numbering: null, title, level: null, depth: 1, sort_order: 0, source_file: first?.file ?? null, position: el.position, blocks: [], children: [] };
  el.sections.push(body);

  let i = 0;
  if (entry) {
    // "Chapter 3" then "Title", or "Chapter 3: Title", or just "Title".
    for (let n = 0; n < 2 && items[i]?.item.kind === "heading" && titleMatches(entry, items[i].item); n++) i++;
  }

  // Inside a chapter, heading levels are as unreliable as everywhere else
  // in converted pages, so they don't nest: every heading is a section at
  // the chapter's top level - except dotted numbering ("1.1", "1.1.2"),
  // which nests by its depth.
  let current = body;
  const numbered = []; // numbered[depth] = open section with that numbering depth
  for (; i < items.length; i++) {
    const { item, file } = items[i];
    if (item.kind === "block") {
      current.blocks.push(item);
      continue;
    }
    const depth = item.numbering?.includes(".") ? item.numbering.split(".").length : null;
    let parent = null;
    if (depth) {
      for (let d = depth - 1; d >= 2 && !parent; d--) parent = numbered[d] ?? null;
      numbered.length = depth;
    }
    const section = {
      role: "section",
      numbering: item.numbering,
      title: item.title || "Untitled",
      level: item.level,
      depth: parent ? parent.depth + 1 : 2,
      sort_order: 0,
      source_file: file,
      position: item.position,
      blocks: [],
      children: [],
    };
    (parent ? parent.children : el.sections).push(section);
    if (depth) numbered[depth] = section;
    current = section;
  }
  return el;
}
