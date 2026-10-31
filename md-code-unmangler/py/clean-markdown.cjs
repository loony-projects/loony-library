'use strict';

/**
 * Step 1 of the Python cleaner (`node cleaner/index.cjs --lang py`, or `--clean` alone).
 * Removes `\_` escapes and fences paragraphs that look like Python. PDF
 * extraction loses information: this does not guess missing newlines or
 * indentation (format-python.cjs does) or repair code spanning pages.
 */

// Only remove known Markdown escapes, never all backslashes. In particular,
// retain Python escapes (\n, \t, quotes), regex escapes (\s, \1, \.), and paths.
function unescapeArtifacts(text) {
  return text.replace(/\\+_/g, '_');
}

function looksLikePython(text) {
  const s = unescapeArtifacts(text).trimStart();
  if (/^(?:#{1,6}\s|!\[|\|)/.test(s)) return false;
  return /^(?:from\s+[\w.]+\s+import\s|import\s+[\w.]+(?:\s|,|$)|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+\s*[:(]|(?:async\s+)?(?:for\s+.+?\s+in\s+.+|with\s+.+|if\s+.+|elif\s+.+|while\s+.+|except(?:\s+.+)?)\s*:|(?:else|try|finally)\s*:|return(?:\s|$)|raise\s+\w|assert\s+|@\w+(?:\.|\())/.test(s)
    || /^[A-Za-z_]\w*(?:(?:\.[A-Za-z_]\w*)|(?:\[[^\n]+?\]))*(?:\s*,\s*[A-Za-z_]\w*)*\s*(?:[+*/%-]=|=(?!=))/.test(s)
    || /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\(/.test(s);
}

// Captions appended by the PDF parser should remain prose. Match only a
// trailing bold annotation outside strings/comments, not ** exponentiation.
function splitAnnotation(text) {
  let quote = null;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === '\n') comment = false;
      else continue;
    }
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (text.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      i += quote.length - 1;
    } else if (ch === '#') {
      comment = true;
    } else if (text.startsWith('**', i) && /\s/.test(text[i - 1] || '')
        && /^\*\*[^*]+\*\*\s*$/.test(text.slice(i))) {
      return [text.slice(0, i).trimEnd(), text.slice(i)];
    }
  }
  return [text, ''];
}

function cleanMarkdown(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let fence = null;
  function flush() {
    if (!paragraph.length) return;
    const block = paragraph.join('\n');
    if (looksLikePython(block)) {
      const [code, annotation] = splitAnnotation(unescapeArtifacts(block));
      const ticks = Math.max(3, ...Array.from(code.matchAll(/`+/g), m => m[0].length + 1));
      const marker = '`'.repeat(ticks);
      out.push(marker + 'py', code, marker);
      if (annotation) out.push('', annotation);
    } else {
      // Keep inline code and link destinations intact; escaped underscores in
      // prose and link labels are common extraction artifacts in this book.
      out.push(block.replace(/(`+)[\s\S]*?\1|\]\([^\n]*?\)|\\+_/g,
        match => /^\\+_$/.test(match) ? '_' : match));
    }
    paragraph = [];
  }
  for (const line of lines) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        out.push(line);
        fence = null;
      } else out.push(fence.python ? unescapeArtifacts(line) : line);
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening) {
      flush();
      const language = opening[2].trim();
      const python = /^(?:py|python|python3)$/i.test(language);
      fence = { char: opening[1][0], length: opening[1].length, python };
      out.push(python ? opening[1] + 'py' : line);
    } else if (!line.trim()) {
      flush();
      out.push(line);
    } else if (/^ {0,3}(?:#{1,6}\s|!\[)/.test(line)) {
      flush();
      out.push(line);
    } else paragraph.push(line);
  }
  flush();
  return out.join(eol);
}

module.exports = { cleanMarkdown, looksLikePython };
