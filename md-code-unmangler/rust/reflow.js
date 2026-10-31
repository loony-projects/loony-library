'use strict';

const INDENT = '    ';

// Placeholders let a profile pull "comment" text out of the code before
// reflow runs, so a comment's contents (which may not be valid Rust, or
// may contain stray braces/semicolons from prose) never confuses the
// brace-depth tracking below. \x00<index>\x00 is opaque to Rust syntax
// and gets swapped back for the real text once reflow is done.
const PLACEHOLDER_RE = /\x00(\d+)\x00/g;

function restorePlaceholders(text, replacements) {
  return text.replace(PLACEHOLDER_RE, (_, idx) => replacements[Number(idx)]);
}

// Brace-depth reflow: break after `{`, before/after `}`, after `;`, and
// around comment placeholders, indenting by nesting depth.
//
//   - String literals are skipped whole so `{}`/`{n}` inside a format
//     string never affects bracket depth or gets mistaken for a comment
//     terminator.
//   - `(`/`[` nesting is tracked separately so a `;` inside an array type
//     like `[i32; 3]` isn't mistaken for a statement separator, while a
//     `;` inside a closure/block passed as a call argument - e.g.
//     `spawn(|| { a; b })` - still breaks normally regardless of the
//     enclosing paren (parens never gate that; only `[...]` does, since a
//     bare `;` directly inside `(...)` with no nested `{}` never happens
//     in valid Rust).
//   - `use a::b::{c, d};` import lists are kept inline rather than being
//     broken up like a real `{ ... }` code block.
//   - `#[attribute]` gets its own line.
function reflow(text) {
  let depth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inAttr = false;
  let attrBaseDepth = 0;
  const out = [];
  let cur = '';
  let i = 0;
  const n = text.length;

  const flushLine = () => {
    const trimmed = cur.trim();
    if (trimmed.length) out.push(INDENT.repeat(depth) + trimmed);
    cur = '';
  };
  const appendToken = (tok) => {
    cur = cur.replace(/\s+$/, '') + tok;
  };

  // Consumes a `{...}` import group verbatim (collapsing internal
  // whitespace but never breaking lines), matching nested `{}` so
  // `a::{b::{c, d}, e}` consumes through the outer closing brace.
  const consumeImportGroup = () => {
    let localDepth = 1;
    let group = '{';
    i++;
    while (i < n && localDepth > 0) {
      const ch = text[i];
      if (ch === '{') localDepth++;
      if (ch === '}') localDepth--;
      if (/\s/.test(ch)) {
        if (!/\s$/.test(group)) group += ' ';
      } else {
        group += ch;
      }
      i++;
    }
    group = group.replace(/\{\s+/g, '{').replace(/\s+\}/g, '}');
    cur += group;
  };

  const afterCloseBrace = () => {
    // cur is currently just '}' (already placed at the new, decremented depth)
    for (;;) {
      const rest = text.slice(i);
      const ws = rest.match(/^\s*/)[0];
      const next = rest[ws.length];
      if (next === ')' || next === ',') {
        appendToken(next);
        i += ws.length + 1;
        continue;
      }
      if (next === ';') {
        appendToken(';');
        i += ws.length + 1;
        flushLine();
        return;
      }
      if (/^else\b/.test(rest.slice(ws.length))) {
        appendToken(' else');
        i += ws.length + 'else'.length;
        return; // hand back to the main loop for "if cond {" or "{"
      }
      flushLine();
      return;
    }
  };

  while (i < n) {
    const c = text[i];

    if (c === '\x00') {
      const end = text.indexOf('\x00', i + 1);
      const token = text.slice(i, end + 1);
      if (cur.trim().length) flushLine();
      cur = token;
      flushLine();
      i = end + 1;
      continue;
    }

    if (/\s/.test(c)) {
      if (cur.length && !/\s$/.test(cur)) cur += ' ';
      i++;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let s = '"';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) {
          s += text[j] + text[j + 1];
          j += 2;
          continue;
        }
        s += text[j];
        j++;
      }
      s += '"';
      cur += s;
      i = j + 1;
      continue;
    }

    if (c === '{') {
      if (cur.replace(/\s+$/, '').endsWith('::')) {
        consumeImportGroup();
        continue;
      }
      appendToken(' {');
      flushLine();
      depth++;
      i++;
      continue;
    }

    if (c === '}') {
      if (cur.trim().length) flushLine();
      depth = Math.max(0, depth - 1);
      cur = '}';
      i++;
      afterCloseBrace();
      continue;
    }

    if (c === '#' && text[i + 1] === '[') {
      if (bracketDepth === 0 && parenDepth === 0) {
        inAttr = true;
        attrBaseDepth = bracketDepth;
      }
      cur += c;
      i++;
      continue;
    }

    if (c === '(' || c === '[') {
      if (c === '(') parenDepth++;
      else bracketDepth++;
      cur += c;
      i++;
      continue;
    }

    if (c === ')' || c === ']') {
      if (c === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
      cur += c;
      i++;
      if (inAttr && c === ']' && bracketDepth === attrBaseDepth) {
        inAttr = false;
        flushLine();
      }
      continue;
    }

    if (c === ';' && bracketDepth === 0) {
      appendToken(';');
      flushLine();
      i++;
      continue;
    }

    cur += c;
    i++;
  }
  flushLine();
  return out.join('\n');
}

// Skips a `"..."` string literal starting at text[i] (which must be the
// opening quote), returning the index just past the matching close quote.
// Shared by profiles that need to be string-literal-aware while scanning
// for their own delimiters (e.g. a `//` comment's end).
function skipStringLiteral(text, i) {
  let j = i + 1;
  const n = text.length;
  while (j < n && text[j] !== '"') {
    if (text[j] === '\\' && j + 1 < n) {
      j += 2;
      continue;
    }
    j++;
  }
  return j + 1;
}

module.exports = { reflow, restorePlaceholders, skipStringLiteral, PLACEHOLDER_RE, INDENT };
