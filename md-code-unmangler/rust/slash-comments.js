'use strict';

const { skipStringLiteral } = require('./reflow');

// Rust keywords used as a heuristic terminator when scanning a `//`
// comment that has no closing delimiter: the comment is assumed to run
// until the next occurrence of one of these as a whole word. Shared by
// any profile whose source uses plain `//` comments with nothing marking
// where they end.
const DEFAULT_KEYWORDS = [
  'fn', 'let', 'impl', 'struct', 'enum', 'match', 'unsafe', 'pub', 'for',
  'while', 'if', 'loop', 'use', 'mut', 'return', 'trait', 'mod', 'const',
  'static', 'async', 'await', 'coroutine', 'break', 'continue', 'else',
];

// Builds an extractComments(text) function that pulls `//` line comments
// with no closing delimiter out into `\x00<index>\x00` placeholders,
// guessing each one ends at the next recognizable statement-starting
// keyword, a `}`, a `**` bold marker, another `//` (starting a separate
// comment - without this, two adjacent comments merge into one line), or
// end of text.
//
// This is string-literal-aware on purpose: a naive regex lookahead for
// `}` will happily "terminate" a comment on the `}` inside a
// format-string placeholder like `"{txt}"`, splitting the string in half
// and leaving the rest of the paragraph with a dangling quote and an
// extra `}` that cascades into badly broken output. Scanning char-by-char
// and skipping whole string literals atomically avoids that.
//
// Guessing the boundary at all is inherently unreliable when the source
// gives no delimiter: if the comment's own prose text contains one of the
// terminator keywords as an ordinary English word (e.g. "... even if the
// event was ready"), the guess is wrong and the comment absorbs a bit of
// real code. That's a property of the source format, not a bug to chase
// further.
function makeSlashCommentExtractor(keywords = DEFAULT_KEYWORDS) {
  const terminatorRe = new RegExp(`^\\s+(?:${keywords.join('|')})\\b`);

  return function extractComments(text) {
    const comments = [];
    let out = '';
    let i = 0;
    const n = text.length;

    while (i < n) {
      if (text[i] === '"') {
        const end = skipStringLiteral(text, i);
        out += text.slice(i, end);
        i = end;
        continue;
      }

      if (text[i] === '/' && text[i + 1] === '/') {
        // Consume the whole leading run of slashes (`//`, `///`, `////`, ...)
        // as one opening marker before scanning for the end, so a doc
        // comment's third slash isn't mistaken for the start of a second,
        // adjacent comment.
        let j = i + 2;
        while (text[j] === '/') j++;
        let end = -1;
        while (j < n) {
          if (text[j] === '"') {
            j = skipStringLiteral(text, j);
            continue;
          }
          const rest = text.slice(j);
          const isAnotherComment = text[j] === '/' && text[j + 1] === '/';
          if (isAnotherComment || terminatorRe.test(rest) || /^\s*\}/.test(rest) || rest.startsWith('**')) {
            end = j;
            break;
          }
          j++;
        }
        if (end === -1) end = n;
        const idx = comments.length;
        comments.push(text.slice(i, end).trimEnd());
        out += `\x00${idx}\x00`;
        i = end;
        continue;
      }

      out += text[i];
      i++;
    }

    return { replaced: out, comments };
  };
}

module.exports = { DEFAULT_KEYWORDS, makeSlashCommentExtractor };
