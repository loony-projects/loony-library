'use strict';

/**
 * Java step of the cleaner (run via `node cleaner/index.cjs --lang java`). Finds
 * Java that PDF extraction squashed into prose paragraphs, as in Java: The
 * Complete Reference, undoes the Markdown escapes (`\*`, `\_`) and formats the
 * code (format-java.cjs) into ```java fences. A paragraph with italic or bold
 * text is left alone: in these books that is a syntax template such as
 * `for(*initialization*; *condition*; *iteration*)`, not a listing. Existing
 * fences are left untouched.
 */
const { formatJava, tokenize } = require('./format-java.cjs');

const NAME = '[A-Za-z_$][\\w$]*';
const PRIMITIVES = 'byte|short|int|long|char|float|double|boolean|void|var';

// How a listing (or a piece of one continued from the previous page) starts.
const JAVA_START = new RegExp('^(?:'
  + '//|/\\*'
  + '|(?:public|private|protected|abstract|final|static)\\s+(?:[\\w<]|\\{)'
  + '|(?:class|interface|enum)\\s+[A-Za-z_][\\w$]*\\s*(?:[{<]|extends\\b|implements\\b)'
  + '|import\\s+(?:static\\s+)?[\\w.]+(?:\\.\\*)?\\s*;|package\\s+[\\w.]+\\s*;|@[A-Z]\\w*|@interface\\b'
  // double volume() { / T getob() { / Gen(T o) {
  + `|(?:(?:${PRIMITIVES})\\b|[A-Z][\\w$]*(?:<[^;()\\s]*(?:,\\s*[^;()\\s]*)*>)?)(?:\\s*\\[\\s*\\])*\\s+${NAME}\\s*\\([^()]*\\)\\s*(?:\\{|throws\\b)`
  + '|[A-Z][\\w$]*\\s*\\([^()]*\\)\\s*\\{|try\\s*\\('
  + `|(?:${PRIMITIVES})(?:\\s*\\[\\s*\\])*\\s+${NAME}\\s*[=;,[(]`
  + `|[A-Z][\\w$]*(?:<[^;()\\s]*(?:,\\s*[^;()\\s]*)*>)?(?:\\s*\\[\\s*\\])*\\s+[a-z_$][\\w$]*\\s*[=;[]`
  + '|(?:if|for|while|switch|synchronized|catch)\\s*\\(|(?:try|do|else|finally)\\s*\\{|else\\b|return\\b[^;]*;'
  + '|break\\s*;|continue\\s*;|throw\\s+new\\b|case\\s+[^:]+:|default\\s*:'
  + '|[{}]'
  + `|${NAME}(?:\\.${NAME}|\\[[^\\]]*\\])*\\s*(?:[-+*/%&|^]|<<|>>>?)?=(?!=)`
  + `|${NAME}(?:\\.${NAME})*\\s*\\(.*\\)\\s*;|${NAME}(?:\\.${NAME})+\\(`
  + `|${NAME}\\s*(?:\\+\\+|--)\\s*;|(?:\\+\\+|--)${NAME}`
  + ')');

// Markdown escapes the extraction added; Java's own (`\n`, `\\`, `\"`) are kept.
const unescape = text => text.replace(/\\([*_$<>#[\]`|~])/g, '$1');
// Italic or bold markup: `*text*`, `**text**` or `__text__` (an escaped `\*` is not).
const hasEmphasis = text => /(?<![\\\w*])\*(?![\s*])[^*\n]*?(?<![\s\\])\*(?![\w*])|(?<!\\)\*\*\S|(?<![\w\\])__\S/.test(text);

// Java keywords, which a run of plain words in code is mostly made of.
const KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do double '
  + 'else enum extends final finally float for goto if implements import instanceof int interface long native new '
  + 'package private protected public return short static strictfp super switch synchronized this throw throws '
  + 'transient try void volatile while var true false null').split(' '));

function looksLikeJava(markdown) {
  if (hasEmphasis(markdown)) return false;
  const code = unescape(markdown).trim();
  // C (a JNI header) is not Java.
  if (/(?:^|\s)#(?:include|ifndef|ifdef|define|endif)\b/.test(code)) return false;
  let tokens;
  try { tokens = tokenize(code, true); } catch { return false; }
  const count = value => tokens.filter(t => t.type === 'punct' && t.value === value).length;
  // A listing continued from the previous page can start mid-expression
  // (`depth + " by " + height + "."; } }`): several statements and braces will do.
  if (!JAVA_START.test(code) && !(count(';') >= 3 && count('{') + count('}') >= 2)) return false;
  const comment = tokens.length && tokens.every(t => t.type === 'comment');
  if (!comment && !count(';') && !count('{') && !count('}')) return false;
  // Prose: three plain English words in a row outside comments and strings
  // (`For example, this call:`); Java puts punctuation or a keyword between names.
  let run = 0;
  for (const t of tokens) {
    run = t.type === 'name' && /^[a-z]+$/.test(t.value) && !KEYWORDS.has(t.value) ? run + 1 : 0;
    if (run >= 3) return false;
  }
  return true;
}

function fence(code) {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), m => m[0].length));
  const marker = '`'.repeat(Math.max(3, longest + 1));
  return [marker + 'java', code, marker];
}

function formatJavaMarkdown(source, width = 80) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const stats = { fenced: 0, skipped: [] };
  let paragraph = [], start = 0;

  function flush() {
    if (!paragraph.length) return;
    const markdown = paragraph.join(' ');
    if (!looksLikeJava(markdown)) out.push(...paragraph);
    else {
      const result = formatJava(unescape(markdown), width);
      stats.fenced++;
      if (result.skipped) stats.skipped.push({ line: start + 1, reason: result.skipped });
      out.push(...fence(result.code));
    }
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^( {0,3})(`{3,}|~{3,})/);
    if (opening) {
      flush();
      const marker = opening[2];
      let end = i + 1;
      for (; end < lines.length; end++) {
        const closing = lines[end].match(/^ {0,3}(`+|~+)\s*$/);
        if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) break;
      }
      out.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }
    // Headings, images, lists, tables and quotes are never code paragraphs.
    if (!lines[i].trim() || /^ {0,3}(?:#{1,6}\s|!\[|[-+]\s|\*\s|\d+\.\s|\||>)/.test(lines[i])) {
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

module.exports = { formatJavaMarkdown, looksLikeJava };
