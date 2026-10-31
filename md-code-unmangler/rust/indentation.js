'use strict';

// Lays out flattened code whose line breaks survive as runs of spaces. In
// this kind of extraction each line break became one space and the next
// line's indentation stayed (often as U+202F narrow no-break spaces), so a
// run of n >= 2 spaces is a line break followed by n - 1 spaces of indentation:
//
//   impl Http {     pub fn get() {         x()     } }
//
// A line at indentation 0 left only a single space, so those breaks are
// found from the structure instead: after a `;`, `}` or `#[attribute]` that
// ends an item at brace depth 0, and before the `}` that closes to depth 0.
//
// Only whitespace changes, so the code itself can't be altered. Returns null
// when there are no runs, or when the result still has statements run
// together on a line (the extraction lost some line breaks entirely), so the
// caller can fall back to the brace-depth reflow.
function layoutFromIndentation(text) {
  text = text.replace(/\u202f/g, ' ').trim();
  if (!/\S {2,}\S/.test(text)) return null;
  const lines = [];
  let line = '';
  let depth = 0;
  let inString = false;
  let inComment = false;

  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === ' ') {
      let j = i;
      while (text[j] === ' ') j++;
      if (j - i >= 2) {
        lines.push(line);
        line = ' '.repeat(j - i - 1);
        inComment = false;
      } else if (!inString && !inComment && breaksAtIndentZero(line, text.slice(j), depth)) {
        lines.push(line);
        line = '';
      } else line += ' ';
      i = j;
      continue;
    }
    if (inComment) {
      line += ch;
      i++;
    } else if (inString) {
      if (ch === '\\' && text[i + 1] !== ' ') {
        line += ch + (text[i + 1] || '');
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      line += ch;
      i++;
    } else if (text.startsWith('//', i)) {
      inComment = true;
      line += '//';
      i += 2;
    } else if (ch === '"') {
      inString = true;
      line += ch;
      i++;
    } else if (ch === "'" && /^'(?:\\.|[^\\'])'/.test(text.slice(i))) {
      // A char literal, not a lifetime: copy it whole so `'{'` doesn't count.
      const literal = text.slice(i).match(/^'(?:\\.|[^\\'])'/)[0];
      line += literal;
      i += literal.length;
    } else {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      line += ch;
      i++;
    }
  }
  lines.push(line);
  const out = lines.map(l => l.trimEnd());
  // A listing continued from the previous page lost its first line's
  // indentation. A first line that opens a block gets the indentation of the
  // `}` that closes it; an attribute, or a line that isn't an item, gets the next line's.
  const indentOf = l => l.length - l.trimStart().length;
  const item = /^(?:#!?\[|(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(?:fn|use|mod|impl|struct|enum|trait|type|const|static|extern)\b)/;
  let indent = 0;
  if (/\{$/.test(out[0])) {
    for (let k = 1, depth = 1; k < out.length; k++) {
      depth += (out[k].match(/\{/g) || []).length - (out[k].match(/\}/g) || []).length;
      if (depth <= 0) {
        if (/^\s*\}/.test(out[k])) indent = indentOf(out[k]);
        break;
      }
    }
  } else if ((!item.test(out[0]) || /^#!?\[/.test(out[0])) && out.length > 1) indent = indentOf(out[1]);
  out[0] = ' '.repeat(indent) + out[0];
  return out.every(complete) ? out.join('\n') : null;
}

// Does a line at indentation 0 start after `line`, given the text that follows?
function breaksAtIndentZero(line, rest, depth) {
  const end = line.trimEnd();
  if (depth === 0 && (/[;}]$/.test(end) || /#!?\[[^\]]*\]$/.test(end))) {
    return !/^(?:else\b|[).,;?])/.test(rest);
  }
  // `field: T, }`, `x(); }` or `format!(...) }`: the `}` that closes an item
  // at depth 0 (but not `{ … }` written on one line), or one that closes a
  // block opened on the previous page.
  return depth <= 1 && /^\}/.test(rest) && !/[{…]$/.test(end);
}

// A line is complete when nothing follows a `{` it leaves open, and no
// statement follows a `;` (strings and `//` comments aside). `[0; 10]` and
// closures like `|| { a; b }` on one line are fine.
function complete(line) {
  // Two comments on a line: the line breaks between them were lost.
  if (/\/\/.*\s\/\/\s/.test(line.replace(/"(?:\\.|[^"\\])*"/g, '""'))) return false;
  const code = line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/.*$/, '')
    .trimEnd();
  const open = [];
  for (let k = 0; k < code.length; k++) {
    const ch = code[k];
    if ('([{'.includes(ch)) open.push(k);
    else if (')]}'.includes(ch)) open.pop();
    else if (ch === ';' && !open.length && code.slice(k + 1).trim()) return false;
  }
  // The last `{` left open must end the line.
  const last = open.filter(k => code[k] === '{').pop();
  return last === undefined || !code.slice(last + 1).trim();
}

module.exports = { layoutFromIndentation };
