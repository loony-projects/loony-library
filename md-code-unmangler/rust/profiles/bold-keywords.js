'use strict';

// Profile for books where the PDF->markdown conversion bolds every Rust
// keyword (**fn**, **let**, **if let**, ...) and marks line "comments"
// with italics (*// comment*), with everything squashed onto one
// paragraph line. \_ and \* are markdown-escaped underscores/asterisks.
// Originally written for rustatomicsandlocks.
//
// Example input:
//   **use** std::collections::VecDeque; **fn** main() { **let** queue = ... }
//
// Comments are kept verbatim (asterisks and all) rather than turned into
// real `//` comments: the source book leaves them as literal italic
// spans once reflowed, and there's no reliable way to tell where a
// same-line comment "ends" versus where it would need a real newline to
// stay valid Rust, so we don't pretend otherwise.

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

// Pulls out bare (non-escaped) *italic* spans - these are the book's line
// "comments" - into opaque placeholders so the reflow tokenizer treats
// each one as a single atom that always gets its own line, and so the
// `\*` unescape step below can't be confused with these markers.
function extractComments(text) {
  const comments = [];
  const replaced = text.replace(/(?<!\\)\*([^*\n]*?)(?<!\\)\*/g, (full) => {
    const idx = comments.length;
    comments.push(full);
    return `\x00${idx}\x00`;
  });
  return { replaced, comments };
}

function stripPseudoMarkdown(line) {
  let s = line.trim();
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1'); // **fn** -> fn
  const { replaced, comments } = extractComments(s);
  s = replaced.replace(/\\_/g, '_').replace(/\\\*/g, '*'); // \_ -> _ , \* -> *
  return { text: s, comments };
}

// Used only to break a tie against bold-plain-comments, which shares
// this profile's exact isCodeParagraph (both bold every keyword, so they
// always match the same lines) but assumes a different comment
// convention. Counts bare, non-escaped `*//` markers - this profile's own
// comment style - across the matched lines.
function tieBreakScore(lines) {
  let score = 0;
  for (const line of lines) {
    score += (line.match(/(?<!\\)\*\/\//g) || []).length;
  }
  return score;
}

module.exports = {
  name: 'bold-keywords',
  description:
    'PDF conversions that **bold** every keyword and *italicize* line comments (e.g. rustatomicsandlocks).',
  isCodeParagraph,
  stripPseudoMarkdown,
  tieBreakScore,
};
