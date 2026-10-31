'use strict';

const { DEFAULT_KEYWORDS, makeSlashCommentExtractor } = require('../slash-comments');
const { layoutFromIndentation: layoutRuns } = require('../indentation');

// Profile for books where the PDF->markdown conversion does NOT bold
// keywords - code paragraphs are flattened plain text, runs of literal
// spaces are leftover line-indentation from the original PDF layout, and
// `//` line comments have no closing delimiter at all. Some pages
// additionally use **bold** to highlight specific lines within a
// listing, and French-guillemet artifacts (« ») sometimes stand in for
// straight double quotes. Originally written for
// Asynchronous_Programming_in_Rust.
//
// Example input:
//   fn main() {     let t_ptr = 99999999999999 as *const usize;     let x =
//   dereference(t_ptr);     println!("{}", x); }
//
// See src/slash-comments.js for how the undelimited `//` comments are
// handled, and its known-limitation caveat.

const KEYWORDS = DEFAULT_KEYWORDS;
const KEYWORD_RE = new RegExp('\\b(?:' + KEYWORDS.join('|') + ')\\b', 'g');
const extractComments = makeSlashCommentExtractor(KEYWORDS);

// How a Rust item or statement starts. A later extraction of this book fences
// most listings itself and leaves short pieces of code as paragraphs, such as
// `use std::io; fn main() {` or `pub struct Executor;`, which are too short
// for the keyword and semicolon counts below.
const RUST_START = new RegExp('^(?:\\*\\*)?(?:'
  + '(?:pub(?:\\([^)]*\\))?\\s+)?(?:(?:async|unsafe|const|extern(?:\\s+"[^"]*")?)\\s+)*'
  + '(?:fn|use|mod|impl|struct|enum|trait|type|const|static|extern)\\b'
  + '|let\\s|#!?\\[|\\}|match\\s|loop\\s|while\\s|for\\s+\\S+\\s+in\\s|if\\s+let\\s|return\\s|//|\\.\\.\\.\\s'
  + '|[a-z_][\\w:]*(?:\\.[a-z_]\\w*)*\\s*(?:\\(|=[^=])' // x.f( / x = / spawn(
  + '|\\*[a-z_]\\w*\\.' // *x.as_mut()
  + '|[A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)+\\s*(?:[,(]|=>)' // pin::Pin, / State0::Start => / Box::new(
  + ')');

// Prose: three plain lowercase words in a row in the code before any `//`
// comment, outside string literals. Rust puts punctuation or a keyword between names.
function looksLikeProse(text) {
  const code = text.split('//')[0].replace(/"(?:\\.|[^"\\])*"/g, '""');
  const words = code.match(/[A-Za-z_][\w']*|[^\sA-Za-z_]/g) || [];
  let run = 0;
  for (const w of words) {
    run = /^[a-z]+$/.test(w) && !RUST_WORDS.has(w) ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}
const RUST_WORDS = new Set(('as async await break const continue crate dyn else enum extern false fn for if impl in let '
  + 'loop match mod move mut pub ref return self static struct super trait true type unsafe use where while').split(' '));

function isCodeParagraph(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('# ') || trimmed.startsWith('```') || trimmed.startsWith('-')) {
    return false;
  }
  // This book has the occasional JS comparison snippet - `function` isn't
  // a Rust keyword, so treat it as a sign this isn't Rust code to convert.
  if (/\bfunction\b|\(\)\s*=>/.test(trimmed)) return false;
  // A Cargo.toml dependency (`mio = { version = "0.8", ... }`) is not Rust.
  if (/^[\w-]+\s*=\s*\{\s*version\s*=/.test(trimmed)) return false;
  const plain = trimmed.replace(/\*\*/g, '').replace(/\\([_*])/g, '$1');
  if (looksLikeProse(plain)) return false;
  if (RUST_START.test(plain) && /[;{}]/.test(plain)) return true;
  // A function signature on its own (`pub fn spawn<F>(future: F) where ...`).
  if (/^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const)\s+)*fn\s+\w+\s*[<(]/.test(plain)) return true;

  const kwCount = (trimmed.match(KEYWORD_RE) || []).length;
  if (kwCount < 2) return false;

  // Real flattened multi-statement code blocks have several `;`; a prose
  // sentence that merely quotes one short code fragment usually has one.
  // A flat statement sequence with no `{}` block at all (e.g. a bit of
  // pseudo-code) needs a higher bar to stay clear of ordinary prose.
  const semicolons = (trimmed.match(/;/g) || []).length;
  const pathSeps = (trimmed.match(/::/g) || []).length;
  if (trimmed.includes('{')) {
    // struct/type definitions are comma- not semicolon-heavy, but real
    // Rust code paths (std::, Self::, module::Type) rarely show up twice
    // in an ordinary sentence, so a couple of `::` is as strong a signal.
    return semicolons >= 2 || (pathSeps >= 2 && semicolons >= 1);
  }
  return semicolons >= 4;
}

function stripPseudoMarkdown(line) {
  // Indentation may come as U+202F narrow no-break spaces, which aren't valid in code.
  let s = line.replace(/\u202f/g, ' ').trim();
  s = s.replace(/[«»]/g, '"'); // PDF font-substitution artifact for straight quotes
  // Lazy `.+?` (not `[^*]+`) because a highlighted span can itself contain
  // a single unescaped `*` (e.g. `**let p = *mut Runtime;**`) - excluding
  // asterisks from the span would leave that `**` pair unstripped.
  s = s.replace(/\*\*(.+?)\*\*/g, '$1'); // **highlighted code** -> code
  const { replaced, comments } = extractComments(s);
  s = replaced.replace(/\\_/g, '_').replace(/\\\*/g, '*'); // \_ -> _ , \* -> *
  return { text: s, comments };
}

// Lays the paragraph out from its runs of spaces when they account for every
// line break (see ../indentation.js); null falls back to the reflow.
function layoutFromIndentation(line) {
  let s = line.trim().replace(/[«»]/g, '"').replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/\\_/g, '_').replace(/\\\*/g, '*');
  return layoutRuns(s);
}

module.exports = {
  name: 'keyword-density',
  description:
    'PDF conversions with no bold markers at all, detected by keyword/semicolon density (e.g. Asynchronous_Programming_in_Rust).',
  isCodeParagraph,
  stripPseudoMarkdown,
  layoutFromIndentation,
};
