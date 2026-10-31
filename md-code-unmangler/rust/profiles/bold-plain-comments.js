'use strict';

const { DEFAULT_KEYWORDS, makeSlashCommentExtractor } = require('../slash-comments');

// Profile for books that bold every keyword like `bold-keywords` does,
// but - unlike that profile's italic *// comment* convention - use plain,
// undelimited `//` comments like `keyword-density` does. Originally
// written for comprehensive-rust-google, discovered when the
// `bold-keywords` profile auto-detected on it and let real `//` comments
// flow straight into the reflow tokenizer with no boundary at all,
// merging separate comments (and the code after them) onto one line.
//
// Example input:
//   **fn** main() { **let** x: i32 = 10; println!("x: {x}"); // x = 20; // println!("x: {x}"); }
//
// See src/slash-comments.js for how the undelimited `//` comments are
// handled, and its known-limitation caveat (a comment's own prose text
// containing a terminator keyword as an ordinary English word will end
// the guess early).

const extractComments = makeSlashCommentExtractor(DEFAULT_KEYWORDS);

function isCodeParagraph(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) return false;

  const boldSpans = [...trimmed.matchAll(/\*\*([^*]+)\*\*/g)];
  if (boldSpans.length < 2) return false;

  // Bold spans in real code paragraphs are short keyword(s) or type names,
  // e.g. "fn", "let mut", "if let", "i32" - not full bolded prose/headings.
  const looksLikeKeywords = boldSpans.every(([, word]) =>
    /^[a-zA-Z][a-zA-Z0-9_ ]{0,15}$/.test(word.trim())
  );
  if (!looksLikeKeywords) return false;

  return trimmed.includes('{') || trimmed.includes(';') || trimmed.includes('::');
}

function stripPseudoMarkdown(line) {
  let s = line.trim();
  // Lazy `.+?` (not `[^*]+`) because a bolded span can itself contain a
  // single unescaped `*` (e.g. `**let p = *mut Runtime;**`) - excluding
  // asterisks from the span would leave that `**` pair unstripped.
  s = s.replace(/\*\*(.+?)\*\*/g, '$1'); // **fn** -> fn
  const { replaced, comments } = extractComments(s);
  s = replaced.replace(/\\_/g, '_').replace(/\\\*/g, '*'); // \_ -> _ , \* -> *
  return { text: s, comments };
}

// Used only to break a tie against bold-keywords, which shares this
// profile's exact isCodeParagraph (both bold every keyword, so they
// always match the same lines) but assumes a different comment
// convention. Counts bare `//` occurrences that are NOT part of a
// `*// ...*` asterisk-wrapped comment (bold-keywords' own style) across
// the matched lines.
function tieBreakScore(lines) {
  let score = 0;
  for (const line of lines) {
    const all = (line.match(/\/\//g) || []).length;
    const asteriskWrapped = (line.match(/(?<!\\)\*\/\//g) || []).length;
    score += all - asteriskWrapped;
  }
  return score;
}

module.exports = {
  name: 'bold-plain-comments',
  description:
    'PDF conversions that **bold** every keyword like bold-keywords, but use plain undelimited // comments like keyword-density (e.g. comprehensive-rust-google).',
  isCodeParagraph,
  stripPseudoMarkdown,
  tieBreakScore,
};
