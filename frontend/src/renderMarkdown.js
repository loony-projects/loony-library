import { marked } from "marked";
import DOMPurify from "dompurify";

// Renders one paragraph's worth of inline markdown (bold, italic, inline
// code, links) with no surrounding block tag - the caller supplies that
// (see Blocks.jsx's Paragraph, which sets this directly on a <p>).
export function renderInline(markdown) {
  return DOMPurify.sanitize(marked.parseInline(markdown ?? ""));
}

// Renders markdown that has its own block structure (lists, blockquotes,
// tables - real <ul>/<blockquote>/<table> output, GFM tables and nested
// lists included), for the caller to set on a neutral wrapper element.
export function renderBlock(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown ?? ""));
}
