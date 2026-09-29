import { parseMarkdownTree, positionOf } from "./markdown.js";
import { plainText } from "./text.js";

// Stage 5 - reference extraction (glossary terms and symbols).
//
// Recognized entry forms - explicit markers only, never "this looks like a
// term":
//   TERM → expansion                 one entry per line, inside a book
//                                    element whose role is glossary/symbols
//                                    (or any source passed to extractTermList)
//   **TERM**: expansion              (also "—" / "–" after the bold term) only
//                                    inside glossary/symbols elements, where
//                                    the element's role makes the bold lead-in
//                                    an explicit marker
//
// Lines are read from paragraphs, list items and blockquotes of the mdast
// tree. Headings, code (fenced, indented or inline), HTML and tables are
// never scanned, so `x → y` inside a code sample never becomes an entry. A
// line with more than one arrow is ambiguous and reported instead of
// guessed at.

const ARROW = "→";
const SKIP = new Set(["heading", "code", "html", "table", "definition", "thematicBreak"]);

// Splits a paragraph's inline children into lines at soft ("\n" inside a
// text node) and hard (break node) line breaks, keeping each line's inline
// nodes so bold lead-ins survive.
function paragraphLines(paragraph) {
  const lines = [[]];
  for (const child of paragraph.children) {
    if (child.type === "break") {
      lines.push([]);
      continue;
    }
    if (child.type === "text" && child.value.includes("\n")) {
      // A soft break advances exactly one source line, so each part's line
      // number is derivable from the text node's start.
      const parts = child.value.split("\n");
      const start = child.position?.start;
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (!part) return;
        const line = start ? start.line + i : null;
        const column = start ? (i === 0 ? start.column : 1) : null;
        const position = start ? { start: { line, column }, end: { line, column: column + part.length } } : undefined;
        lines[lines.length - 1].push({ type: "text", value: part, position });
      });
      continue;
    }
    lines[lines.length - 1].push(child);
  }
  return lines.filter((line) => line.length);
}

function lineText(nodes) {
  return nodes.map(plainText).join("").replace(/\s+/g, " ").trim();
}

function* paragraphsOf(node) {
  if (SKIP.has(node.type)) return;
  if (node.type === "paragraph") {
    yield node;
    return;
  }
  for (const child of node.children ?? []) yield* paragraphsOf(child);
}

function parseLine(nodes, { allowBoldLeadIn }) {
  const text = lineText(nodes);
  if (!text) return null;
  const arrows = text.split(ARROW).length - 1;
  if (arrows === 1) {
    const [term, expansion] = text.split(ARROW).map((s) => s.trim());
    if (term && expansion) return { term, expansion };
    return { invalid: `"${text}" has an empty side of "${ARROW}".` };
  }
  if (arrows > 1) return { invalid: `"${text}" has ${arrows} "${ARROW}" markers; ambiguous.` };

  if (allowBoldLeadIn && nodes[0]?.type === "strong") {
    const term = plainText(nodes[0]).replace(/\s+/g, " ").trim().replace(/[:—–]\s*$/, "");
    const rest = lineText(nodes.slice(1)).replace(/^[:—–]\s*/, "");
    const hadSeparator = /[:—–]\s*$/.test(plainText(nodes[0]).trim()) || /^[:—–]/.test(lineText(nodes.slice(1)));
    if (term && rest && hadSeparator) return { term, expansion: rest };
  }
  return null;
}

export function termKey(term, { caseSensitive = false } = {}) {
  const normalized = term.normalize("NFKC").replace(/\s+/g, " ").trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/**
 * Extracts term entries from an mdast tree (or any subtree).
 * Returns [{ term, expansion, position }] in source order plus any
 * per-line diagnostics; de-duplication happens in collectTerms.
 */
export function extractTermEntries(tree, { file = null, diagnostics = null, allowBoldLeadIn = false, source = null } = {}) {
  const entries = [];
  for (const paragraph of paragraphsOf(tree)) {
    for (const line of paragraphLines(paragraph)) {
      const parsed = parseLine(line, { allowBoldLeadIn });
      if (!parsed) continue;
      const position = positionOf(line[0], file) ?? positionOf(paragraph, file);
      if (parsed.invalid) {
        diagnostics?.warning("terms.invalid_entry", parsed.invalid, { position });
        continue;
      }
      entries.push({ ...parsed, position });
    }
  }
  if (source !== null && !entries.length) {
    diagnostics?.warning("terms.no_entries", `No "TERM ${ARROW} expansion" entries found.`, { file });
  }
  return entries;
}

/**
 * Merges raw entries into a de-duplicated list keyed by normalized term.
 * First definition wins; an identical repeat is reported as info, a
 * different definition for the same key as a warning and kept on the
 * winning entry's `conflictingDefinitions` rather than overwritten or lost.
 */
export function collectTerms(entries, { kind, caseSensitive = false, diagnostics = null } = {}) {
  const byKey = new Map();
  const result = [];
  for (const entry of entries) {
    const key = termKey(entry.term, { caseSensitive });
    const existing = byKey.get(key);
    if (!existing) {
      const record = { ...entry, key };
      byKey.set(key, record);
      result.push(record);
      continue;
    }
    const where = { position: entry.position, elementId: entry.ownerId };
    if (termKey(existing.expansion) === termKey(entry.expansion)) {
      diagnostics?.info(`${kind}.duplicate`, `"${entry.term}" is defined again with the same definition; kept once.`, where);
      continue;
    }
    diagnostics?.warning(
      `${kind}.conflict`,
      `"${entry.term}" already defined as "${existing.expansion}"; conflicting definition "${entry.expansion}" kept in conflictingDefinitions.`,
      where
    );
    (existing.conflictingDefinitions ??= []).push({ expansion: entry.expansion, position: entry.position });
  }
  return result;
}

// Backwards-compatible entry point: a whole term-list file's source ->
// [{ term, expansion, position }].
export function extractTermList(source, options = {}) {
  return extractTermEntries(parseMarkdownTree(source), { ...options, source });
}
