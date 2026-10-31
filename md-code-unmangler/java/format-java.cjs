'use strict';

/**
 * Java formatter for the cleaner's --lang java step. PDF extraction flattened
 * each listing onto one line, so line breaks and indentation are rebuilt from
 * the braces and semicolons, in the style of Java: The Complete Reference:
 * 2-space indentation, `} else {` on one line, `case` labels indented inside
 * `switch`, a blank line between methods, and array initializers kept on one
 * line when they fit. Spacing within a line is left as the author wrote it.
 * A `//` comment has no line end in flattened code, so where it ends is
 * guessed: at the first later words that are unmistakably Java. Every result
 * is checked: re-tokenizing it must give the original tokens.
 */

const INDENT = '  ';
// Marks the known end of a `//` comment, when the Markdown says where it is.
const COMMENT_END = '';

const PUNCTUATORS = ['>>>=', '<<=', '>>=', '>>>', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
const PRIMITIVES = 'byte|short|int|long|char|float|double|boolean|void|var';
const NAME = '[A-Za-z_$][\\w$]*';
// Type arguments, `<T>` or `<String, Integer>`: no spaces except after a comma,
// so `<T> constructor. MyFunc<Integer>` in a comment is not one.
const GENERIC = '<[^;()\\s]*(?:,\\s*[^;()\\s]*)*>';

// Where code resumes after the words of a `//` comment: statements and
// declarations that English prose doesn't produce.
const RESUMES = new RegExp('^(?:'
  + `(?:final\\s+)?(?:${PRIMITIVES})\\b\\s*(?:\\[\\s*\\]\\s*)*${NAME}\\s*(?:[=;,:)]|\\[)` // int x = / long days;
  + `|(?:final\\s+)?[A-Z][\\w$]*(?:\\.[A-Z][\\w$]*)*(?:${GENERIC})?(?:\\s*\\[\\s*\\])*\\s+[a-z_$][\\w$]*\\s*(?:[=;]|\\[\\s*\\])` // Box b = / String s;
  + '|(?:if|for|while|switch|catch|synchronized|try)\\s*\\('
  + '|(?:else|try|do|finally)\\s*(?:\\{|if\\b)|else\\s+[\\w$.]+\\s*(?:\\(|=|\\+\\+|--)'
  + '|return\\s*;|return\\s+(?:"[^"]*"|\'[^\']*\'|-?\\d[\\w.]*|\\([^;]*\\)|new\\s+[^;]*|[\\w$.]+\\s*(?:\\([^;]*\\))?\\s*(?:(?:[-+*%<>=!&|?]|/(?!/))(?:(?!//)[^;])*)?)\\s*;'
  + `|break\\s*;|continue\\s*;|(?:break|continue)\\s+${NAME}\\s*;|throw\\s+new\\b`
  + `|${NAME}(?:\\.${NAME}|\\s*\\[[^\\]]*\\])*\\s*(?:[-+*/%&|^]|<<|>>>?)?=(?!=)` // x = / a[i] += / this.x =
  + `|${NAME}(?:\\.${NAME})+\\s*\\(` // System.out.println( / ob.show(
  // double volume() { / void setDim(double w, ...) { / Box(double w) {
  + `|(?:(?:${PRIMITIVES})\\b|[A-Z][\\w$]*(?:${GENERIC})?)(?:\\s*\\[\\s*\\])*\\s+${NAME}\\s*\\([^()]*\\)\\s*(?:\\{|throws\\b)`
  + `|[A-Z][\\w$]*\\s*\\([^()]*\\)\\s*\\{`
  + `|[a-z_$][\\w$]*\\s*\\([^()]*\\)\\s*;` // show();
  + `|[a-z_$][\\w$]*\\((?:new\\s+[A-Z]|this\\b|")` // addWindowListener(new
  + `|${NAME}\\s*(?:\\+\\+|--)\\s*;|(?:\\+\\+|--)${NAME}`
  + '|\\}|//|/\\*'
  + '|(?:public|private|protected)\\s+(?:(?:static|final|abstract|synchronized|native|default|class|interface|enum|'
  + PRIMITIVES + ')\\b|[A-Z<@])'
  + '|static\\s+(?:void|final|\\{|<|[A-Z]|(?:' + PRIMITIVES + ')\\b)'
  + '|(?:abstract\\s+|final\\s+)?(?:class|interface|enum)\\s+[A-Z][\\w$]*\\s*(?:\\{|extends\\b|implements\\b|<)'
  + '|import\\s+(?:static\\s+)?[\\w.]+(?:\\.\\*)?\\s*;|package\\s+[\\w.]+\\s*;|@[A-Z]\\w*'
  + `|new\\s+[A-Z][\\w$]*\\s*(?:<[^>]*>)?\\s*\\(|(?:this|super)\\s*\\([^()]*\\)\\s*;|(?:this|super)\\.${NAME}\\s*[(=]`
  + ')');

// In flattened code a `//` comment has no line end: it ends where code resumes
// (at a word boundary after at least one word of comment). Commented-out code
// (`// y = 100;`) ends after its first statement.
function lineCommentEnd(src, start) {
  const marked = src.indexOf(COMMENT_END, start);
  const newline = src.indexOf('\n', start);
  let limit = src.length;
  if (marked !== -1) limit = marked;
  if (newline !== -1 && newline < limit) limit = newline;
  if (marked !== -1 || newline !== -1) return limit;
  const body = start + 2;
  const first = src.slice(body).match(/^\s*/)[0].length + body;
  if (RESUMES.test(src.slice(first)) && !/^(?:\}|\/\/|\/\*)/.test(src.slice(first))) {
    const semicolon = src.indexOf(';', first);
    // `// if(x) // System.out.println(x);`: two lines of commented-out code.
    const nextComment = src.indexOf('//', first);
    if (nextComment !== -1 && (semicolon === -1 || nextComment < semicolon)
        && RESUMES.test(src.slice(nextComment + 2).trimStart())) return nextComment;
    if (semicolon !== -1) {
      // `// y = 100; // Error! y not known here` is one comment, but each line
      // of commented-out code (`// a(); // b();`) is a comment of its own.
      const next = src.slice(semicolon + 1).match(/^\s*\/\/\s*/);
      if (!next) return semicolon + 1;
      const after = semicolon + 1 + next[0].length;
      return RESUMES.test(src.slice(after)) ? semicolon + 1 : lineCommentEnd(src, after - next[0].length + next[0].indexOf('/'));
    }
  }
  const words = /\s+(?=\S)/g;
  words.lastIndex = first;
  let m;
  while ((m = words.exec(src))) {
    const at = m.index + m[0].length;
    if (RESUMES.test(src.slice(at))) return m.index;
  }
  return src.length;
}

// ---------------------------------------------------------------------------
// Tokenizer

function tokenize(src, flattened = false) {
  const tokens = [];
  let i = 0;
  let space = false;
  const push = (type, value, extra) => {
    tokens.push({ type, value, space, ...extra });
    space = false;
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch) || ch === COMMENT_END) { space = true; i++; continue; }
    const rest = src.slice(i);
    let m;
    if (rest.startsWith('//')) {
      const end = flattened ? lineCommentEnd(src, i) : (src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i));
      push('comment', src.slice(i, end).trimEnd());
      i = end;
    } else if (rest.startsWith('/*')) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push('comment', src.slice(i, stop), { block: true });
      i = stop;
    } else if (rest.startsWith('"""')) {
      const end = src.indexOf('"""', i + 3);
      const stop = end === -1 ? src.length : end + 3;
      push('str', src.slice(i, stop));
      i = stop;
    } else if (ch === '"' || ch === "'") {
      // A literal still open at the end continues on the next page.
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push(ch === '"' ? 'str' : 'char', src.slice(i, Math.min(j + 1, src.length)));
      i = j + 1;
    } else if ((m = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[lLfFdD]?/.exec(rest))) {
      push('num', m[0]);
      i += m[0].length;
    } else if ((m = /^[A-Za-z_$À-￿][\w$À-￿]*/.exec(rest))) {
      push('name', m[0]);
      i += m[0].length;
    } else {
      const punct = PUNCTUATORS.find(p => rest.startsWith(p)) || ch;
      push('punct', punct);
      i += punct.length;
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Layout

const isPunct = (t, ...values) => Boolean(t) && t.type === 'punct' && values.includes(t.value);
const isName = (t, ...values) => Boolean(t) && t.type === 'name' && (!values.length || values.includes(t.value));

// Joins tokens on one line with the author's spacing.
function join(tokens) {
  return tokens.map((t, k) => (k && t.space ? ' ' : '') + t.value).join('');
}

// A `{` that opens an array initializer (`= {`, `new int[] {`, `{ {` inside
// one, `@A({`), not a block or class body.
function isInitializer(tokens, k, frames) {
  const prev = tokens[k - 1];
  const top = frames[frames.length - 1];
  if (top.kind === 'init') return true;
  return isPunct(prev, '=', ']', '(') || (isPunct(prev, ',') && top.parens > 0);
}

// Finds the `}` matching the `{` at k.
function closingBrace(tokens, k) {
  for (let depth = 0, j = k; j < tokens.length; j++) {
    if (isPunct(tokens[j], '{')) depth++;
    else if (isPunct(tokens[j], '}') && --depth === 0) return j;
  }
  return -1;
}

// What kind of body a `{` opens, from the statement head before it.
function braceKind(head) {
  if (head.some(t => isName(t, 'class', 'interface', 'enum'))) return 'class';
  // `new Runnable() {`: an anonymous class.
  if (head.length >= 3 && isPunct(head[head.length - 1], ')')) {
    let depth = 0, j = head.length - 1;
    for (; j >= 0; j--) {
      if (isPunct(head[j], ')')) depth++;
      else if (isPunct(head[j], '(') && --depth === 0) break;
    }
    // `new Name(...)` or `new Name<T>(...)`.
    let n = j - 1;
    if (isPunct(head[n], '>')) while (n > 0 && !isPunct(head[n], '<')) n--;
    if (isPunct(head[n], '<')) n--;
    if (isName(head[n]) && isName(head[n - 1], 'new')) return 'class';
  }
  if (head.length && isName(head.find(t => t.type !== 'comment'), 'switch')) return 'switch';
  return 'block';
}

// Lays out tokens as lines. A fragment that starts inside nested braces (a
// listing continued from the previous page) starts at the depth it closes.
function layout(tokens, width) {
  let deficit = 0;
  for (let depth = 0, k = 0; k < tokens.length; k++) {
    if (isPunct(tokens[k], '{')) depth++;
    else if (isPunct(tokens[k], '}')) deficit = Math.max(deficit, -(--depth));
  }
  const lines = [];
  const frames = [];
  for (let d = 0; d <= deficit; d++) frames.push({ kind: 'block', parens: 0, members: 0, lastBlock: false, inCase: false });
  let line = [];
  let head = []; // tokens of the current statement, to classify the next `{`
  const depth = () => frames.length - 1 + frames.filter(f => f.inCase).length;
  let lineDepth = depth();

  const flush = () => {
    if (line.length) {
      const comment = line.every(t => t.type === 'comment');
      lines.push({ depth: lineDepth, text: join(line), tokens: comment ? null : line, comment });
    }
    line = [];
    lineDepth = depth();
  };
  // A blank line, placed before the comments that lead into what follows.
  const blank = () => {
    let at = lines.length;
    while (at > 0 && lines[at - 1].comment && lines[at - 1].depth === depth()) at--;
    if (at > 0 && lines[at - 1].text !== '') lines.splice(at, 0, { depth: 0, text: '' });
  };
  // Would this trailing comment take the line past the width?
  const tooLong = t => INDENT.length * lineDepth + join([...line, t]).length > width;
  const add = t => {
    if (!line.length) lineDepth = depth();
    line.push(t);
  };
  // A new statement or member starts: in a class body, a blank line separates
  // a method or nested class from the members around it.
  const startStatement = k => {
    const top = frames[frames.length - 1];
    if (frames.length === 1) {
      // A blank line after the imports, and before each top-level class.
      const isImport = isName(tokens[k], 'import', 'package');
      if (top.afterImport && !isImport) blank();
      top.afterImport = isImport;
      for (let j = k; j < tokens.length && !isPunct(tokens[j], '{', ';'); j++) {
        if (isName(tokens[j], 'class', 'interface', 'enum')) return blank();
      }
    }
    if (top.kind !== 'class') return;
    const opensBlock = (() => {
      for (let j = k, parens = 0; j < tokens.length; j++) {
        if (isPunct(tokens[j], '(')) parens++;
        else if (isPunct(tokens[j], ')')) parens--;
        else if (!parens && isPunct(tokens[j], ';', '}')) return false;
        else if (!parens && isPunct(tokens[j], '{')) return !isPunct(tokens[j - 1], '=', ']');
      }
      return false;
    })();
    if (top.members && (opensBlock || top.lastBlock)) blank();
    top.members++;
    top.lastBlock = opensBlock;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const top = frames[frames.length - 1];
    if (!line.length && t.type !== 'comment' && !isPunct(t, '}') && !head.length) startStatement(k);
    if (t.type === 'comment') {
      // After `}`, or before a method in a class body, a comment introduces
      // what follows, so it goes on its own line; otherwise it trails the code.
      if (line.length && !t.block && (leadsInto(tokens, k, top) || tooLong(t))) flush();
      if (!t.block) {
        add(t);
        flush();
      } else if (line.length) add(t);
      else {
        for (const text of blockCommentLines(t.value, depth(), width)) lines.push({ depth: depth(), text, comment: true });
        lineDepth = depth();
      }
      continue;
    }
    if (isPunct(t, '(', '[')) top.parens++;
    if (isPunct(t, ')', ']')) top.parens = Math.max(0, top.parens - 1);

    // `case X:` and `default:` start a line in a switch, with their statements below.
    if (top.kind === 'switch' && !top.parens && !line.length && isName(t, 'case', 'default')) {
      top.inCase = false;
      let j = k;
      while (j < tokens.length && !(isPunct(tokens[j], ':') || isPunct(tokens[j], '->'))) j++;
      if (j < tokens.length && isPunct(tokens[j], ':')) {
        for (let n = k; n <= j; n++) add(tokens[n]);
        flush();
        top.inCase = true;
        lineDepth = depth();
        k = j;
        continue;
      }
    }

    if (isPunct(t, '{')) {
      if (isInitializer(tokens, k, frames)) {
        const end = closingBrace(tokens, k);
        const inner = end === -1 ? null : tokens.slice(k, end + 1);
        const text = inner && join([...line, ...inner]);
        if (inner && !inner.some(n => n.type === 'comment') && (lineDepth * INDENT.length) + text.length <= width) {
          inner.forEach(add);
          k = end;
          continue;
        }
        add(t);
        flush();
        frames.push({ kind: 'init', parens: 0, members: 0, lastBlock: false, inCase: false });
        lineDepth = depth();
        continue;
      }
      add(t);
      const kind = braceKind(head);
      const doBody = isName(head[head.length - 1], 'do');
      // `if(x == 10) { // start new scope` keeps its comment, if it fits.
      if (tokens[k + 1] && tokens[k + 1].type === 'comment' && !tokens[k + 1].block && !tooLong(tokens[k + 1])) add(tokens[++k]);
      flush();
      frames.push({ kind, doBody, parens: 0, members: 0, lastBlock: false, inCase: false });
      head = [];
      lineDepth = depth();
      continue;
    }
    if (isPunct(t, '}')) {
      flush();
      const closed = frames.length > 1 ? frames.pop() : frames[0];
      lineDepth = depth();
      add(t);
      head = [];
      const next = tokens[k + 1];
      // Keep `} else {`, `} catch`, `} while(...);`, `});`, `},` and `};` together.
      if (closed.kind === 'init') {
        if (isPunct(next, ',', ';', ')', '}')) continue;
      } else if (isName(next, 'else', 'catch', 'finally') || isPunct(next, ';', ',', ')', '.')
          || (isName(next, 'while') && closed.doBody)) continue;
      if (next && next.type === 'comment' && !next.block) continue;
      flush();
      continue;
    }
    if (top.kind === 'init' && isPunct(t, ',') && !top.parens) {
      add(t);
      flush();
      continue;
    }
    add(t);
    if (top.kind !== 'init') head.push(t);
    if (isPunct(t, ';') && !top.parens) {
      head = [];
      const next = tokens[k + 1];
      if (next && next.type === 'comment' && !next.block) continue;
      flush();
    }
    // `@Override` gets its own line before the member it annotates.
    if (isPunct(t, '@') && !top.parens && line.length === 1 && isName(tokens[k + 1]) && !isName(tokens[k + 1], 'interface')) {
      add(tokens[++k]);
      head.push(tokens[k]);
      if (isPunct(tokens[k + 1], '(') && !tokens[k + 1].space) {
        const close = matching(tokens, k + 1);
        for (let n = k + 1; n <= close; n++) { add(tokens[n]); head.push(tokens[n]); }
        k = close;
      }
      flush();
    }
  }
  flush();
  return lines;
}

// Does the comment at k introduce the code after it rather than trail the line before?
function leadsInto(tokens, k, frame) {
  const prev = tokens[k - 1];
  let j = k + 1;
  while (tokens[j] && tokens[j].type === 'comment') j++;
  const next = tokens[j];
  if (!next || isPunct(next, '}')) return false;
  if (isPunct(prev, '}')) return !isName(next, 'else', 'catch', 'finally', 'while');
  // A sentence (`// Here, a more complex expression is used.`) introduces the
  // next statement; a short note (`// convert to seconds`) trails its line.
  const continued = tokens[k + 1] && tokens[k + 1].type === 'comment';
  if (/^\/\/\s*[A-Z][a-z]/.test(tokens[k].value) && (/[.:!]$/.test(tokens[k].value) || continued)) return true;
  if (frame.kind !== 'class') return false;
  for (let parens = 0; j < tokens.length; j++) {
    if (isPunct(tokens[j], '(')) parens++;
    else if (isPunct(tokens[j], ')')) parens--;
    else if (!parens && isPunct(tokens[j], ';', '}', '=')) return false;
    else if (!parens && isPunct(tokens[j], '{')) return true;
  }
  return false;
}

function matching(tokens, k) {
  for (let depth = 0, j = k; j < tokens.length; j++) {
    if (isPunct(tokens[j], '(')) depth++;
    else if (isPunct(tokens[j], ')') && --depth === 0) return j;
  }
  return tokens.length - 1;
}

// A block comment on its own line: `/** ... */` and `/* * a * b */` get one
// line per ` * `; a long plain one is wrapped between `/*` and `*/` lines.
function blockCommentLines(value, depth, width) {
  const closed = value.endsWith('*/') && value.length >= 4;
  const javadoc = value.startsWith('/**');
  const body = value.slice(javadoc ? 3 : 2, closed ? -2 : undefined).trim();
  const pad = INDENT.repeat(depth);
  if (/^\*\s/.test(body) || javadoc) {
    const parts = body.split(/\s+\*(?=\s|$)|^\*\s/).map(s => s.trim());
    if (!parts[0]) parts.shift();
    return [javadoc ? '/**' : '/*', ...parts.map(s => (s ? ` * ${s}` : ' *')), ...(closed ? [' */'] : [])];
  }
  if (pad.length + value.length <= width) return [value];
  const lines = ['/*'];
  let current = '';
  for (const word of body.split(/\s+/)) {
    if (current && pad.length + 3 + current.length + 1 + word.length > width) {
      lines.push(`   ${current}`);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(`   ${current}`);
  if (closed) lines.push('*/');
  return lines;
}

// Breaks a line that is too long after a comma or before `+`, `&&`, `||`, at
// the shallowest bracket depth that has such a place; continuation lines are
// indented twice. Returns the pieces, or null if there is nowhere to break.
function breakLine(tokens, room) {
  const places = [];
  for (let k = 1, depth = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (isPunct(t, '(', '[', '{')) depth++;
    else if (isPunct(t, ')', ']', '}')) depth--;
    else if (isPunct(tokens[k - 1], ',', ';') && t.type !== 'comment') places.push({ k, depth });
    else if (isPunct(t, '+', '&&', '||', '?', ':') && k > 1) places.push({ k, depth });
  }
  if (!places.length || tokens[tokens.length - 1].type === 'comment' && places.every(p => p.k >= tokens.length - 1)) return null;
  const shallowest = Math.min(...places.map(p => p.depth));
  const usable = places.filter(p => p.depth === shallowest);
  const fitting = usable.filter(p => join(tokens.slice(0, p.k)).length <= room);
  const at = (fitting.length ? fitting[fitting.length - 1] : usable[0]).k;
  return [tokens.slice(0, at), tokens.slice(at)];
}

// Statement lines longer than the width are broken: an `if`/`for`/`while`
// header puts its single statement on the next line, indented; other lines
// break at commas and operators (see breakLine).
function wrap(lines, width) {
  const out = [];
  for (const l of lines) {
    if (l.text === '' || INDENT.length * l.depth + l.text.length <= width || !l.tokens) {
      out.push(l);
      continue;
    }
    const tokens = l.tokens;
    if (isName(tokens[0], 'if', 'for', 'while') && isPunct(tokens[1], '(')) {
      const close = matching(tokens, 1);
      if (close < tokens.length - 1 && !isPunct(tokens[close + 1], '{', ';')) {
        out.push({ depth: l.depth, text: join(tokens.slice(0, close + 1)), tokens: tokens.slice(0, close + 1) });
        const rest = tokens.slice(close + 1);
        wrap([{ depth: l.depth + 1, text: join(rest), tokens: rest }], width).forEach(r => out.push(r));
        continue;
      }
    }
    const pieces = breakLine(tokens, width - INDENT.length * l.depth);
    if (pieces) {
      out.push({ depth: l.depth, text: join(pieces[0]), tokens: pieces[0] });
      let rest = pieces[1];
      // Continuation lines: indented twice, broken again while they are too long.
      for (;;) {
        const room = width - INDENT.length * (l.depth + 2);
        const more = join(rest).length > room ? breakLine(rest, room) : null;
        if (!more || !more[0].length) break;
        out.push({ depth: l.depth + 2, text: join(more[0]).trimStart(), tokens: more[0] });
        rest = more[1];
      }
      out.push({ depth: l.depth + 2, text: join(rest).trimStart(), tokens: rest });
      continue;
    }
    out.push(l);
  }
  return out;
}

function render(lines) {
  return lines.map(l => (l.text ? INDENT.repeat(l.depth) + l.text : '')).join('\n')
    .replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
}

// Comments are compared with their whitespace collapsed, since a block comment
// may be laid out over several lines.
const signature = tokens => tokens.map(t => `${t.type}:${t.type === 'comment' ? t.value.replace(/\s+/g, ' ') : t.value}`);
function sameTokens(a, b) {
  return a.length === b.length && a.every((t, k) => t === b[k]);
}

// Formats flattened Java. Returns { code } or, when the result would not
// re-tokenize to the same tokens, { code, skipped } with the code on its
// original lines.
function formatJava(source, width = 80) {
  const tokens = tokenize(source, true);
  const code = render(wrap(layout(tokens, width), width));
  if (sameTokens(signature(tokens), signature(tokenize(code)))) return { code };
  return { code: source.replace(new RegExp(COMMENT_END, 'g'), ' ').trim(), skipped: 'formatting would change the code' };
}

module.exports = { formatJava, tokenize, lineCommentEnd, COMMENT_END };
