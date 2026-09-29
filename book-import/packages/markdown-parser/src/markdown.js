import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Stage 1 - ingestion. The only place Markdown source is turned into an
// mdast tree: CommonMark + GFM (tables, footnotes, strikethrough, task
// lists, autolinks). Front matter, directives and MDX are deliberately not
// enabled - no book source uses them, and enabling them would change how
// existing sources parse (a leading "---" block, a stray ":name").
const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdownTree(source) {
  return processor.parse(source);
}

// Source position of an mdast node, tagged with the file it came from so a
// location stays meaningful across a multi-file book.
export function positionOf(node, file) {
  if (!node?.position) return file ? { file } : undefined;
  const { start, end } = node.position;
  return {
    file: file ?? null,
    start: { line: start.line, column: start.column, offset: start.offset },
    end: { line: end.line, column: end.column, offset: end.offset },
  };
}

// Exact source text of a node. Unlike the old rawSlice this does not trim:
// callers that want trimmed markdown trim explicitly, and code-carrying
// nodes keep their indentation intact.
export function sourceOf(source, node) {
  if (!node?.position) return "";
  return source.slice(node.position.start.offset, node.position.end.offset);
}
