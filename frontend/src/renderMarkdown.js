import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";

// Math: $...$ inline and $$...$$ display, as LaTeX, rendered with KaTeX
// before markdown can touch it (so x_1 and \{ survive). A $ only opens math
// when the closing $ is followed by a space, punctuation or the end, so
// prices ("$5 or $10") and shell prompts stay text - none of the library's
// non-math $ signs render as math. Bad LaTeX shows as red source, not an
// error.
marked.use(markedKatex({ throwOnError: false, strict: "ignore", output: "htmlAndMathml" }));

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
