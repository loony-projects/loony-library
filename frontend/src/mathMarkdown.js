import katex from "katex";

// LaTeX math in book markdown: $...$ inline, $$...$$ display - rendered
// with KaTeX before markdown can touch it (so x_1 and \{ survive).
//
// An opening $ comes at the start, after a space, an opening bracket, quote
// or dash, or after a Devanagari letter, and isn't followed by a space; a
// closing $ isn't preceded by a space and is followed by a space, the end,
// punctuation or an operator - including ; ( ) ∠ = + and the Devanagari
// danda "।" - or a letter (Bodo postpositions attach to a formula: "$x$आ",
// "$\pi r^2$।"; "$\frac{1}{4}$th", "$\frac{1}{2}$A"). So prices ("$5 or
// $10"), shell prompts ("luciano$ telnet") and variables ("$HOME and
// $(date)") stay text: their would-be formula ends in a space.
// Bad LaTeX shows as red source.
const INLINE = /^(\${1,2})(?![\s$])((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$\s]))\1(?=[\s?!.,:;()[\]{}'"।॥—–\-∠<>=+×/]|\p{Script=Devanagari}|[A-Za-z]|$)/u;
const OPENING = /(^|[\s([{'"“‘—–-]|\p{Script=Devanagari})\$/u;
const BLOCK = /^\$\$\n?((?:\\[\s\S]|[^\\])+?)\n?\$\$[ \t]*(?:\n|$)/;

export const renderTex = (tex, displayMode) =>
  katex.renderToString(tex, { displayMode, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });

export const mathExtensions = [
  {
    name: "blockMath",
    level: "block",
    start: (src) => src.match(/^\$\$/m)?.index,
    tokenizer(src) {
      const m = BLOCK.exec(src);
      if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
    },
    renderer: (token) => `<p class="math-display">${renderTex(token.text, true)}</p>\n`,
  },
  {
    name: "inlineMath",
    level: "inline",
    start(src) {
      const m = OPENING.exec(src);
      return m ? m.index + m[1].length : undefined;
    },
    tokenizer(src) {
      const m = INLINE.exec(src);
      if (m) return { type: "inlineMath", raw: m[0], text: m[2].trim(), display: m[1].length === 2 };
    },
    renderer: (token) => renderTex(token.text, token.display),
  },
];
