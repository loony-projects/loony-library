'use strict';

/**
 * JavaScript step of the cleaner (run via `node cleaner/index.cjs --lang js`).
 * Finds code that PDF extraction squashed into prose paragraphs, splits it from
 * a leading `*Listing N-M.* file.js` caption, and fences it: JavaScript and JSON
 * are formatted Prettier-style (format-js.cjs), HTML gets one tag per line, and
 * `$ command` shell sessions get one command per line. Existing ```js, ```json
 * and ```html fences are formatted in place; other fences are left untouched.
 */
const { formatJs, formatJson, COMMENT_END } = require('./format-js.cjs');

const JS_FENCES = /^(?:js|javascript|jsx|mjs|cjs|node)$/i;
const JSON_FENCES = /^(?:json|json5|jsonc)$/i;
const HTML_TAGS = 'html|head|body|script|div|p|span|ul|ol|li|form|input|button|a|h[1-6]|table|tr|td|th|link|meta|style|template|section|header|footer|nav|main|img|label|select|option|textarea|title';
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Some books bold every keyword (`**const** x`, `__**dirname**`). Like Markdown,
// a bold span has no space just inside its `**`, so `a ** 2 ** 3` is left alone.
const stripBold = text => text.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1');
// Some books italicize comments (`f() *//outputs Boo* g()`): the closing `*` tells
// exactly where the comment ends, so mark that spot for the formatter.
const markItalicComments = text => text.replace(/(?<![*\w])\*(\/\/[^*\n]*?)\*(?!\*)/g, `$1${COMMENT_END}`);
const unescape = text => stripBold(text).replace(/\\([_$*#[\]`])/g, '$1');

// A paragraph is JavaScript only if it starts with unmistakable syntax and
// contains statement punctuation, so prose that mentions code stays prose.
const JS_START = new RegExp('^(?:'
  + '(?:var|let|const)\\s+(?:[A-Za-z_$][\\w$]*\\s*[=;,]|[[{])'
  + '|(?:async\\s+)?function\\s*\\*?\\s*(?:[A-Za-z_$][\\w$]*)?\\s*\\('
  + '|class\\s+[A-Za-z_$][\\w$]*\\s*(?:extends\\b|\\{)'
  + '|(?:if|for|while|switch)\\s*\\('
  + '|(?:try|do|else)\\s*\\{'
  + '|\\}\\s*(?:else\\b|catch\\b|finally\\b|\\)|;|,)' // a listing continued from the previous page
  + '|throw\\s+new\\b'
  + '|[\'"]use strict[\'"]'
  + '|import\\s+(?:[\\w$*{]|[\'"])'
  + '|export\\s+(?:default|const|let|var|function|class|\\{)'
  + '|\\(\\s*function\\b'
  + '|//\\s*\\S+.*[;{]'
  + '|[A-Za-z_$][\\w$]*(?:\\??\\.[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])*(?:\\(|\\s*(?:[-+*/%]?=(?!=)|\\+\\+|--))'
  + '|(?:[A-Za-z_$][\\w$]*\\s+)?\\.[A-Za-z_$][\\w$]*\\(' // a method chain: `.use(` or `promise .then(`
  + ')');

function looksLikeJs(text) {
  const code = unescape(markItalicComments(text)).replace(new RegExp(COMMENT_END, 'g'), ' ').trim();
  return JS_START.test(code) && (/[;{]/.test(code) || /\)\s*(?:\/\/.*)?$/.test(code));
}

// A line of a sentence: a capitalized word and several more plain words.
function isProseLine(text) {
  const line = text.trim();
  return /^[A-Z][\w’'-]*(?:[ ,]+[\w’'"()-]+){3,}/.test(line) && !/[;{}]\s*$/.test(line) && !looksLikeJs(line);
}

function classify(text) {
  const code = unescape(text).trim();
  if (/^\$ \S/.test(code)) return 'console';
  if (new RegExp(`^<(?:!DOCTYPE|!--|(?:${HTML_TAGS})\\b)`, 'i').test(code)) return 'html';
  if (/^(?:\{\s*"|\[\s*[{["\d])/.test(code) && formatJson(code)) return 'json';
  if (looksLikeJs(code)) return 'js';
  return null;
}

// Shell sessions: start each `$ command` on its own line.
function formatConsole(text) {
  return unescape(text).trim().split(/\s+(?=\$ \S)/).join('\n');
}

// HTML: one tag per line, indented by nesting; short elements stay on one line.
function formatHtml(text) {
  const parts = unescape(text).trim().match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || [];
  const pieces = parts.map(p => p.trim()).filter(Boolean);
  const lines = [];
  let depth = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const name = (piece.match(/^<\/?([A-Za-z][\w-]*)/) || [])[1]?.toLowerCase();
    const closing = piece.startsWith('</');
    const opening = name && !closing && !piece.endsWith('/>') && !VOID_TAGS.has(name) && !piece.startsWith('<!');
    if (closing) depth = Math.max(0, depth - 1);
    // <tag>text</tag> or <tag></tag> on one line.
    if (opening) {
      const text = pieces[i + 1] && !pieces[i + 1].startsWith('<') ? pieces[i + 1] : '';
      const end = pieces[i + (text ? 2 : 1)];
      if (end && end.toLowerCase() === `</${name}>`) {
        lines.push('  '.repeat(depth) + piece + text + end);
        i += text ? 2 : 1;
        continue;
      }
    }
    lines.push('  '.repeat(depth) + piece);
    if (opening) depth++;
  }
  return lines.join('\n');
}

function fence(language, code) {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), m => m[0].length));
  const marker = '`'.repeat(Math.max(3, longest + 1));
  return [marker + language, code, marker];
}

// Format one piece of code of a known kind; JavaScript that cannot be
// formatted safely is still fenced, unchanged apart from Markdown escapes.
function render(kind, code, width, stats, line) {
  stats.fenced[kind] = (stats.fenced[kind] || 0) + 1;
  if (kind === 'console') return fence('console', formatConsole(code));
  if (kind === 'html') return fence('html', formatHtml(code));
  if (kind === 'json') {
    const result = formatJson(unescape(code), width);
    if (result && !result.valid) stats.invalid.push({ line, reason: 'JSON does not parse' });
    return fence('json', result ? result.code : unescape(code));
  }
  const result = formatJs(markItalicComments(stripBold(code)), width);
  if (result.skipped) stats.skipped.push({ line, reason: result.skipped });
  else if (!result.valid) stats.invalid.push({ line, reason: 'JavaScript does not compile' });
  return fence('js', result.skipped ? unescape(code) : result.code);
}

// Split `*Listing 2-43.* error1.js try { ... }` into the caption and the code. A
// running page header (`Chapter 6 ■ Getting Started with HTTP`) is split off the same way.
function splitCaption(paragraph) {
  const caption = paragraph.match(/^(?:\*{1,2}Listing [\w.-]+\.?\*{1,2}|Chapter \d+ ■)\s*/);
  if (!caption) return null;
  const rest = paragraph.slice(caption[0].length);
  for (const word of rest.matchAll(/\S+/g)) {
    const kind = classify(rest.slice(word.index));
    if (kind) return { caption: (caption[0] + rest.slice(0, word.index)).trim(), code: rest.slice(word.index), kind };
  }
  return null;
}

function formatJsMarkdown(source, width = 80) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const stats = { fenced: {}, formatted: 0, blocks: 0, skipped: [], invalid: [] };
  let paragraph = [], start = 0;

  // A paragraph's lines are grouped into prose and code (some extractions put a
  // sentence on the line right after a listing). A code group can hold several
  // listings, `code *Listing 3-10.* app.js code`: each caption starts a segment.
  function flush() {
    if (!paragraph.length) return;
    const line = start + 1;
    const groups = [];
    for (const text of paragraph) {
      const prose = paragraph.length > 1 && isProseLine(text);
      if (!groups.length || groups[groups.length - 1].prose !== prose) groups.push({ prose, lines: [] });
      groups[groups.length - 1].lines.push(text);
    }
    const blocks = groups.map(group => {
      if (group.prose) return [{ code: group.lines.join('\n') }];
      return group.lines.join(' ').split(/\s+(?=\*{1,2}Listing [\w.-]+\.?\*{1,2}\s)/)
        .map(segment => splitCaption(segment) || { code: segment, kind: classify(segment) });
    }).flat();
    if (!blocks.some(b => b.kind)) out.push(...paragraph);
    else {
      blocks.forEach((b, i) => {
        if (i) out.push('');
        if (b.caption) out.push(b.caption, '');
        if (b.kind) out.push(...render(b.kind, b.code, width, stats, line));
        else out.push(b.code);
      });
    }
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (opening) {
      flush();
      const [, pad, marker, info] = opening;
      let end = i + 1;
      for (; end < lines.length; end++) {
        const closing = lines[end].match(/^ {0,3}(`+|~+)\s*$/);
        if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) break;
      }
      const language = info.trim();
      const kind = JS_FENCES.test(language) ? 'js' : JSON_FENCES.test(language) ? 'json' : /^html$/i.test(language) ? 'html' : null;
      if (end >= lines.length || !kind) {
        out.push(...lines.slice(i, end + 1));
      } else {
        stats.blocks++;
        const code = lines.slice(i + 1, end).join('\n');
        let formatted = code;
        if (kind === 'js') {
          const result = formatJs(code, width);
          if (result.skipped) stats.skipped.push({ line: i + 1, reason: result.skipped });
          else formatted = result.code;
        } else if (kind === 'json') formatted = formatJson(code, width)?.code ?? code;
        else formatted = formatHtml(code);
        if (formatted !== code) stats.formatted++;
        out.push(pad + marker + info, formatted, pad + marker);
      }
      i = end;
      continue;
    }
    // Headings, images, lists, tables and quotes are never code paragraphs.
    if (!lines[i].trim() || /^ {0,3}(?:#{1,6}\s|!\[|[-+*]\s|\d+\.\s|\||>)/.test(lines[i])) {
      flush();
      out.push(lines[i]);
      continue;
    }
    if (!paragraph.length) start = i;
    paragraph.push(lines[i]);
  }
  flush();
  return { text: out.join('\n').replace(/\n/g, eol), ...stats };
}

module.exports = { formatJsMarkdown, looksLikeJs, classify, formatHtml, formatConsole };
