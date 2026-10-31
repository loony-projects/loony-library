'use strict';

/**
 * JavaScript and JSON formatter for the cleaner's --lang js step, in the spirit of
 * Prettier: 2-space indentation, an 80-column width, and bracket groups that
 * stay on one line when they fit and break one item per line when they don't.
 * PDF extraction flattened most listings onto one line, so statement breaks are
 * rebuilt from braces, semicolons and automatic-semicolon-insertion cues, and
 * where an unterminated `//` comment ends is guessed. Every result is checked:
 * re-tokenizing it must give the original tokens (only whitespace, line breaks
 * and trailing commas may change), and code that compiled must still compile.
 */
const vm = require('node:vm');

const INDENT = '  ';
const KEYWORDS = new Set(('await break case catch class const continue debugger default delete do else export '
  + 'extends finally for function if import in instanceof let new return super switch this throw try typeof '
  + 'var void while with yield null true false undefined').split(' '));
// Keywords that behave like values: they end an expression.
const VALUE_WORDS = new Set(['this', 'super', 'null', 'true', 'false', 'undefined']);
const CONTROL = new Set(['if', 'for', 'while', 'with', 'switch', 'catch']);
// Contextual words that start a class member or function without ending a statement.
const MODIFIERS = new Set(['static', 'get', 'set', 'async']);
const RESTRICTED = new Set(['return', 'break', 'continue', 'throw', 'yield']);
const PUNCTUATORS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=',
  '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const STATEMENT_LISTS = new Set(['program', 'block', 'class']);

const isName = (n, ...values) => Boolean(n) && n.type === 'name' && (!values.length || values.includes(n.value));
const isPunct = (n, ...values) => Boolean(n) && n.type === 'punct' && (!values.length || values.includes(n.value));
const isGroup = (n, ...kinds) => Boolean(n) && n.type === 'group' && (!kinds.length || kinds.includes(n.kind));
const isLineComment = n => Boolean(n) && n.type === 'comment' && !n.block;
// A keyword after `.` is a property name (`.catch(`, `.delete(`), so it acts like a value.
const isValueName = n => isName(n) && (n.property || !KEYWORDS.has(n.value) || VALUE_WORDS.has(n.value));
const isExprEndToken = t => Boolean(t) && (['num', 'str', 'tmpl', 'regex'].includes(t.type) || isValueName(t)
  || (t.type === 'punct' && (CLOSERS.has(t.value) || t.value === '++' || t.value === '--')));
const unescapeMarkdown = text => text.replace(/\\([_*$#])/g, '$1');
// Marks the known end of a `//` comment (see markItalicComments in markdown-js.cjs).
const COMMENT_END = '\uE000';

// ---------------------------------------------------------------------------
// Tokenizer

// In flattened code a `//` comment has no line end, so guess where code
// resumes: the first later word with unmistakable JavaScript syntax.
function resumesCode(rawWord, next = '', next2 = '', depth, balance) {
  const word = unescapeMarkdown(rawWord);
  if (word.startsWith('//') || word.startsWith('/*')) return true;
  const opener = { ')': '(', ']': '[', '}': '{' }[word[0]];
  if (opener) return depth > 0 && balance[opener] === 0;
  if (/^(?:var|let|const)$/.test(word)) {
    return /^[A-Za-z_$][\w$]*[;,]?$/.test(next) && (word === 'var' || /[;,]$/.test(next) || /^[-+*/%]?=/.test(next2));
  }
  if (/^function\*?\(/.test(word)) return true;
  if (word === 'function' || word === 'function*') return /^(?:\*\s*)?(?:[A-Za-z_$][\w$]*)?\(/.test(next);
  if (/^(?:if|for|while|switch|catch)\(/.test(word)) return true;
  if (/^(?:if|for|while|switch|catch)$/.test(word)) return next.startsWith('(');
  // `return x;`, or in semicolon-free code `return "http://" + ...`, but not `return the value`.
  if (word === 'return') {
    return /;$/.test(next) || /^(?:['"`\d[{(!-]|(?:this|new|function|null|true|false|undefined)\b|[A-Za-z_$][\w$]*[.([])/.test(next);
  }
  if (word === 'throw') return next === 'new';
  if (word === 'case') return /:$/.test(next) || /^:/.test(next2);
  if (word === 'default:') return true;
  if (/^(?:try|else|do)\{/.test(word)) return true;
  if (['try', 'else', 'do'].includes(word)) return next === '{';
  if (word === 'async') return /^function\*?$/.test(next) && /^\*?(?:[A-Za-z_$][\w$]*)?\(/.test(next2);
  // `willReject .then(` starts code, but `register a middleware .use(` does not: only
  // a word spelled like an identifier (camelCase, digits, _ or $) counts.
  if (/^[A-Za-z_$][\w$]*$/.test(word) && /[A-Z\d_$]/.test(word.slice(1)) && /^\.[A-Za-z_$][\w$]*\(/.test(next)) return true;
  if (/^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(/.test(word)) return true; // call, or `.use(` in a chain
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:[[;=]|\+\+|--)/.test(word)) return true; // member access
  return /^[A-Za-z_$][\w$.]*$/.test(word.replace(/[;,]$/, ''))
    && /^(?:[-+*/%&|^]|\*\*|<<|>>>?)?=$/.test(next); // assignment
}

function lineCommentEnd(src, start, depth, flattened) {
  const newline = src.indexOf('\n', start);
  const lineEnd = newline < 0 ? src.length : newline;
  const marked = src.indexOf(COMMENT_END, start);
  if (marked >= 0 && marked < lineEnd) return marked;
  if (!flattened) return lineEnd;
  const words = [...src.slice(start + 2, lineEnd).matchAll(/\S+/g)].map(m => [m[0], m.index]);
  const balance = { '(': 0, '[': 0, '{': 0 };
  for (let w = 0; w < words.length; w++) {
    const [word, index] = words[w];
    if (w > 0 && resumesCode(word, words[w + 1]?.[0], words[w + 2]?.[0], depth, balance)) return start + 2 + index;
    // Some extractions keep a run of spaces where a line break was.
    if (w > 0 && index - (words[w - 1][1] + words[w - 1][0].length) >= 3) return start + 2 + index;
    for (const c of word) {
      if (c in balance) balance[c]++;
      else if (')]}'.includes(c)) {
        const opener = { ')': '(', ']': '[', '}': '{' }[c];
        if (balance[opener] > 0) balance[opener]--;
      }
    }
  }
  return lineEnd;
}

function templateEnd(src, i) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') j += 2;
    else if (src[j] === '`') return j + 1;
    else if (src.startsWith('${', j)) j = substitutionEnd(src, j + 2);
    else j++;
  }
  return src.length;
}

function substitutionEnd(src, j) {
  let depth = 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j++;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j++;
    } else if (c === '`') j = templateEnd(src, j);
    else {
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
  }
  return src.length;
}

function regexEnd(src, i) {
  let j = i + 1, inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\n') return 0;
    if (c === '\\') { j += 2; continue; }
    if (inClass) { if (c === ']') inClass = false; }
    else if (c === '[') inClass = true;
    else if (c === '/') {
      j++;
      while (/[a-z]/i.test(src[j] || '')) j++;
      return j > i + 2 ? j : 0;
    }
    j++;
  }
  return 0;
}

function tokenize(source, flattened) {
  let src = source;
  const tokens = [];
  const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;
  const NAME = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
  let i = 0, space = false, newlines = 0, depth = 0;
  const push = (type, value, start, extra) => {
    tokens.push({ type, value, space, newlines, start, end: start + value.length, ...extra });
    space = false;
    newlines = 0;
  };
  const previous = () => {
    for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].type !== 'comment') return tokens[k];
    return null;
  };
  const at = re => { re.lastIndex = i; return re.exec(src); };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { newlines++; space = true; i++; continue; }
    if (/\s/.test(ch) || ch === COMMENT_END) { space = true; i++; continue; }
    if (ch === '\\' && src[i + 1] !== 'u') {
      // Outside strings a backslash is a Markdown escape (\_ \$ \*). Drop it and
      // re-read the token before it, so `foo\_bar` and `function\*` join up.
      src = src.slice(0, i) + src.slice(i + 1);
      const prev = tokens[tokens.length - 1];
      if (prev && !space && prev.end === i && ['name', 'num', 'punct'].includes(prev.type)
          && !OPENERS[prev.value] && !CLOSERS.has(prev.value)) {
        tokens.pop();
        ({ start: i, space, newlines } = prev);
      }
      continue;
    }
    if (src.startsWith('//', i)) {
      const end = lineCommentEnd(src, i, depth, flattened);
      push('comment', unescapeMarkdown(src.slice(i, end).trimEnd()), i);
      i = end;
      continue;
    }
    if (src.startsWith('/*', i) || src.startsWith('/\\*', i)) { // also a Markdown-escaped /\* ... \*/
      const close = src.slice(i + 2).search(/\\?\*\//);
      const end = close < 0 ? src.length : src.indexOf('/', i + 2 + close) + 1;
      push('comment', src.slice(i, end).replace(/\\\*/g, '*'), i, { block: true });
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const end = Math.min(src.length, src[j] === ch ? j + 1 : j);
      // \_ \$ \* inside a string are identity escapes in JavaScript, so dropping
      // the Markdown backslash never changes the string's value.
      push('str', src.slice(i, end).replace(/\\([\s\S])/g, (m, c) => ('_$*#'.includes(c) ? c : m)), i);
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = templateEnd(src, i);
      push('tmpl', src.slice(i, end).replace(/\\([\s\S])/g, (m, c) => ('_*#'.includes(c) ? c : m)), i);
      i = end;
      continue;
    }
    if (ch === '/' && !isExprEndToken(previous())) {
      const end = regexEnd(src, i);
      if (end) { push('regex', src.slice(i, end), i); i = end; continue; }
    }
    const number = (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || ''))) && at(NUMBER);
    if (number) { push('num', number[0], i); i += number[0].length; continue; }
    const name = at(NAME);
    if (name) {
      push('name', name[0], i, isPunct(previous(), '.', '?.') ? { property: true } : undefined);
      i += name[0].length;
      continue;
    }
    let punct = PUNCTUATORS.find(p => src.startsWith(p, i)) || ch;
    if (punct === '?.' && /\d/.test(src[i + 2] || '')) punct = '?';
    if (OPENERS[punct]) depth++;
    else if (CLOSERS.has(punct)) depth = Math.max(0, depth - 1);
    push('punct', punct, i);
    i += punct.length;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Bracket tree

function lastSignificant(children) {
  for (let k = children.length - 1; k >= 0; k--) if (children[k].type !== 'comment') return [children[k], k];
  return [null, -1];
}

function braceKind(parent) {
  if (parent.kind === 'json') return 'object';
  const [prev, k] = lastSignificant(parent.children);
  const statementList = STATEMENT_LISTS.has(parent.kind);
  if (!prev) return statementList ? 'block' : 'object';
  if (prev.type === 'group') return prev.kind === 'paren' || statementList ? 'block' : 'object'; // `) {` is a body
  if (prev.type === 'punct') return ['=>', ';', '}'].includes(prev.value) ? 'block' : 'object';
  if (prev.type === 'name') {
    if (['else', 'try', 'finally', 'do'].includes(prev.value)) return 'block';
    if (KEYWORDS.has(prev.value) && !VALUE_WORDS.has(prev.value)) return 'object';
    const words = parent.children.slice(0, k).filter(n => n.type === 'name').map(n => n.value);
    if (words.includes('class')) return 'class';
    return statementList ? 'block' : 'object';
  }
  return statementList ? 'block' : 'object';
}

function buildTree(tokens, rootKind) {
  const root = { type: 'group', kind: rootKind, children: [], open: null, close: null };
  const stack = [root];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'punct' && OPENERS[t.value]) {
      const [prev] = lastSignificant(top.children);
      let kind = 'paren';
      if (t.value === '[') kind = isExprEndToken(prev) || isGroup(prev, 'paren', 'index', 'object') ? 'index' : 'array';
      if (t.value === '{') kind = braceKind(top);
      const group = { type: 'group', kind, children: [], open: t, close: null };
      top.children.push(group);
      stack.push(group);
      continue;
    }
    if (t.type === 'punct' && CLOSERS.has(t.value)) {
      const match = stack.map(g => g.open && OPENERS[g.open.value]).lastIndexOf(t.value);
      if (match > 0) {
        stack.length = match + 1; // Groups opened inside it stay unclosed.
        stack.pop().close = t;
        continue;
      }
    }
    top.children.push(t);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Document printer (a small version of Prettier's / Wadler's algorithm)

const hardline = { t: 'line', hard: true };
const line = { t: 'line' };
const softline = { t: 'line', soft: true };
const breakParent = { t: 'break' };
const group = (contents, shouldBreak = false) => ({ t: 'group', contents, break: shouldBreak });
const indent = contents => ({ t: 'indent', contents });
const ifBreak = (breakContents, flatContents = '') => ({ t: 'ifBreak', breakContents, flatContents });
// Printed just before the next line break and not measured, like Prettier's
// lineSuffix: a trailing comment never forces the code before it to wrap.
const lineSuffix = contents => ({ t: 'suffix', contents });
const trailingComment = comment => [lineSuffix(' ' + comment.value), breakParent];

function propagateBreaks(doc) {
  if (!doc || typeof doc === 'string') return false;
  if (Array.isArray(doc)) return doc.map(propagateBreaks).some(Boolean);
  switch (doc.t) {
    case 'line': return Boolean(doc.hard);
    case 'break': return true;
    case 'indent': return propagateBreaks(doc.contents);
    case 'ifBreak': return propagateBreaks(doc.breakContents);
    case 'suffix': return false;
    case 'group': {
      if (propagateBreaks(doc.contents)) doc.break = true;
      return doc.break;
    }
  }
  return false;
}

function fits(next, rest, width) {
  let remaining = width, r = rest.length;
  const stack = [next];
  while (remaining >= 0) {
    if (!stack.length) {
      if (!r) return true;
      stack.push(rest[--r]);
      continue;
    }
    const { mode, doc } = stack.pop();
    if (typeof doc === 'string') { remaining -= doc.length; continue; }
    if (Array.isArray(doc)) { for (let i = doc.length - 1; i >= 0; i--) stack.push({ mode, doc: doc[i] }); continue; }
    if (doc.t === 'indent') stack.push({ mode, doc: doc.contents });
    else if (doc.t === 'group') stack.push({ mode: doc.break ? 'break' : mode, doc: doc.contents });
    else if (doc.t === 'ifBreak') stack.push({ mode, doc: mode === 'break' ? doc.breakContents : doc.flatContents });
    else if (doc.t === 'line') {
      if (mode === 'break' || doc.hard) return true;
      if (!doc.soft) remaining--;
    }
  }
  return false;
}

function printDoc(doc, width) {
  let out = '', pos = 0, suffix = '';
  const cmds = [{ ind: 0, mode: 'break', doc }];
  while (cmds.length) {
    const { ind, mode, doc: d } = cmds.pop();
    if (typeof d === 'string') { out += d; pos += d.length; continue; }
    if (Array.isArray(d)) { for (let i = d.length - 1; i >= 0; i--) cmds.push({ ind, mode, doc: d[i] }); continue; }
    if (d.t === 'indent') cmds.push({ ind: ind + 1, mode, doc: d.contents });
    else if (d.t === 'suffix') suffix += d.contents;
    else if (d.t === 'ifBreak') cmds.push({ ind, mode, doc: mode === 'break' ? d.breakContents : d.flatContents });
    else if (d.t === 'group') {
      const flat = { ind, mode: 'flat', doc: d.contents };
      if (mode === 'flat' && !d.break) cmds.push(flat);
      else cmds.push(!d.break && fits(flat, cmds, width - pos) ? flat : { ind, mode: 'break', doc: d.contents });
    } else if (d.t === 'line') {
      if (mode === 'flat' && !d.hard) {
        if (!d.soft) { out += ' '; pos++; }
      } else {
        out = out.replace(/[ \t]+$/, '') + suffix + '\n' + INDENT.repeat(ind);
        suffix = '';
        pos = ind * INDENT.length;
      }
    }
  }
  return (out + suffix).split('\n').map(l => l.trimEnd()).join('\n');
}

// ---------------------------------------------------------------------------
// JavaScript to document

const newlinesBefore = n => (n.type === 'group' ? (n.open ? n.open.newlines : 0) : n.newlines);
const firstToken = n => (n.type === 'group' ? n.open : n);

function nextSignificant(nodes, k) {
  while (k < nodes.length && nodes[k].type === 'comment') k++;
  return nodes[k];
}

function lastIndex(nodes) {
  for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k].type !== 'comment') return k;
  return -1;
}

// Does nodes[k] end an expression (so a following name starts a new statement)?
function endsExpression(nodes, k) {
  const n = nodes[k];
  if (!n) return false;
  if (n.type !== 'group') return isExprEndToken(n) && !MODIFIERS.has(n.value) && !isPunct(n, '}'); // stray `}`
  if (n.kind === 'paren') return !(isName(nodes[k - 1]) && !nodes[k - 1].property && CONTROL.has(nodes[k - 1].value));
  return ['index', 'array', 'object'].includes(n.kind);
}

function isPrefixOperator(nodes, k) {
  const n = nodes[k];
  if (!isPunct(n, '-', '+', '++', '--', '!', '~')) return false;
  if (isPunct(n, '!', '~')) return true;
  const prev = nodes[k - 1];
  if (!prev) return true;
  if (prev.type === 'group') return ['block', 'class'].includes(prev.kind);
  if (prev.type === 'punct') return !CLOSERS.has(prev.value) && prev.value !== '++' && prev.value !== '--';
  return prev.type === 'name' && !isValueName(prev);
}

class Printer {
  constructor({ flattened, json }) {
    this.flattened = flattened;
    this.json = json;
  }

  startsStatement(current, nodes, k) {
    const n = nodes[k], p = lastIndex(current), prev = current[p];
    if (!prev) return false;
    if (RESTRICTED.has(prev.value) && isName(prev) && newlinesBefore(n) && !this.flattened) return true;
    if (!isName(n)) return false;
    // `break`, `continue` and `debugger` take no expression (labels are rare), and a
    // comment after `return` or `throw` meant a line break, which ends the statement.
    if (isName(prev, 'debugger', 'break', 'continue')) return true;
    if (RESTRICTED.has(prev.value) && isName(prev) && isLineComment(current[current.length - 1])) return true;
    const v = n.value;
    // `if (a) return x() else ...` needs a line break before `else` without semicolons.
    if (v === 'else') return endsExpression(current, p);
    if (['catch', 'finally', 'in', 'instanceof', 'of'].includes(v)) return false;
    if (v === 'case' || v === 'default') return !isName(prev, 'export');
    if (v === 'while' && isName(current[0], 'do')) return false;
    return endsExpression(current, p);
  }

  // After a block `{...}`, does the statement end?
  blockEndsStatement(current, nodes, k) {
    const next = nextSignificant(nodes, k + 1);
    if (!next) return true;
    if (isName(next)) {
      if (['else', 'catch', 'finally', 'in', 'instanceof'].includes(next.value)) return false;
      return !(next.value === 'while' && isName(current[0], 'do'));
    }
    const declaration = isName(current[0], 'if', 'for', 'while', 'switch', 'try', 'function', 'class', 'do', 'with')
      || (isName(current[0], 'async') && isName(current[1], 'function'));
    if (next.type === 'punct') return next.value === '}'; // `} )` from a page break stays together
    if (next.type === 'group') return declaration || ['block', 'object', 'class'].includes(next.kind);
    return true;
  }

  splitStatements(nodes) {
    const statements = [];
    let current = [];
    const end = () => { if (current.length) statements.push(current); current = []; };
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.type === 'comment') {
        const last = statements[statements.length - 1];
        // A comment inside a statement stays in it (`connect() // why` then `.use(...)`);
        // the usual rules below decide whether the next code starts a new statement.
        if (current.length && (this.flattened || !n.newlines)) {
          current.push(n);
        } else if (!current.length && last && !isLineComment(last[last.length - 1]) && !n.block
            && (this.flattened ? isPunct(last[last.length - 1], ';') : !n.newlines)) {
          last.push(n); // A comment after `;` on the same line trails that statement.
        } else {
          end();
          statements.push([n]);
        }
        continue;
      }
      if (current.length && this.startsStatement(current, nodes, k)) end();
      current.push(n);
      if (isPunct(n, ';')) end();
      else if ((isGroup(n, 'block', 'class') || isPunct(n, '}')) && this.blockEndsStatement(current, nodes, k)) end();
    }
    end();
    return statements;
  }

  printBody(nodes) {
    const items = [];
    let inCase = false;
    for (const statement of this.splitStatements(nodes)) {
      const blank = !this.flattened && newlinesBefore(statement[0]) > 1;
      const first = statement[0];
      if (isName(first, 'case', 'default')) {
        let colon = -1, ternary = 0;
        for (let k = 1; k < statement.length && colon < 0; k++) {
          if (isPunct(statement[k], '?')) ternary++;
          else if (isPunct(statement[k], ':')) { if (ternary) ternary--; else colon = k; }
        }
        if (colon > 0) {
          items.push({ doc: this.printNodes(statement.slice(0, colon + 1)), level: 0, blank });
          inCase = true;
          if (colon + 1 < statement.length) items.push({ doc: this.printNodes(statement.slice(colon + 1)), level: 1 });
          continue;
        }
      }
      items.push({ doc: this.printNodes(statement), level: inCase ? 1 : 0, blank });
    }
    const parts = [];
    items.forEach((item, i) => {
      const separator = i ? [hardline, item.blank ? hardline : ''] : [];
      if (item.level) parts.push(indent([...separator, item.doc]));
      else parts.push(...separator, item.doc);
    });
    return parts;
  }

  spaceBetween(nodes, k, bracket, ternary) {
    const L = nodes[k - 1], R = nodes[k];
    const lv = L.type === 'group' ? null : L.value, rv = R.type === 'group' ? null : R.value;
    if (L.type === 'comment') return !isPunct(R, ',', ';');
    const tight = L.type === 'punct' && (['.', '?.', '...'].includes(lv) || isPrefixOperator(nodes, k - 1));
    if (R.type === 'group') {
      if (tight) return false;
      if (R.kind === 'paren') {
        if (L.type === 'name') return !isValueName(L); // `if (` and `function (`, but `foo(` and `.catch(`
        return L.type === 'punct';
      }
      if (R.kind === 'index') return false;
      return true;
    }
    if (R.type === 'punct') {
      if ([',', ';', '.', '?.', ')', ']'].includes(rv)) return false; // `)` `]` here are stray closers
      if (rv === ':') return ternary > 0;
      if ((rv === '++' || rv === '--') && !isPrefixOperator(nodes, k) && endsExpression(nodes, k - 1)) return false;
      if (rv === '*' && isName(L, 'function', 'yield')) return false;
    }
    if (L.type === 'group') return true;
    if (tight) return false;
    if (R.type === 'tmpl' && isValueName(L)) return false; // tagged template
    return true;
  }

  printNodes(nodes, bracket = null, continued = false) {
    const parts = [];
    let ternary = 0;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (isLineComment(n)) {
        if (k === nodes.length - 1) parts.push(...(k ? trailingComment(n) : [n.value, breakParent]));
        else if (!k) parts.push(n.value, breakParent, hardline);
        else if (nodes.slice(k + 1).every(isLineComment)) {
          // Only comments follow: they are standalone lines, not a continuation.
          parts.push(...trailingComment(n));
          for (const c of nodes.slice(k + 1)) parts.push(hardline, c.value, breakParent);
          break;
        }
        else {
          // Code continuing after a comment mid-statement is indented once, as Prettier does.
          const rest = [hardline, ...this.printNodes(nodes.slice(k + 1), bracket, true)];
          parts.push(' ', n.value, breakParent, continued ? rest : indent(rest));
          break;
        }
        continue;
      }
      if (k && !isLineComment(nodes[k - 1]) && this.spaceBetween(nodes, k, bracket, ternary)) parts.push(' ');
      if (isPunct(n, '?')) ternary++;
      else if (isPunct(n, ':') && ternary) ternary--;
      parts.push(n.type === 'group' ? this.printGroup(n, nodes, k) : n.value);
    }
    return parts;
  }

  splitItems(children) {
    const items = [];
    let body = [], comments = [];
    const flush = () => {
      while (isLineComment(body[body.length - 1])) comments.unshift(body.pop());
      items.push({ body, comments });
      body = [];
      comments = [];
    };
    for (const c of children) {
      if (isPunct(c, ',')) { flush(); continue; }
      if (isLineComment(c) && !body.length && items.length && (this.flattened || !c.newlines)) {
        items[items.length - 1].comments.push(c);
        continue;
      }
      body.push(c);
    }
    if (body.length) flush();
    return items;
  }

  printItems(items, open, trailingComma) {
    const parts = [];
    items.forEach((item, i) => {
      parts.push(this.printNodes(item.body, open));
      if (i < items.length - 1) parts.push(',');
      else if (trailingComma && item.body.length) parts.push(ifBreak(','));
      for (const c of item.comments) parts.push(...trailingComment(c));
      if (i < items.length - 1) parts.push(line);
    });
    return parts;
  }

  printList(g, spaces) {
    const open = g.open.value, close = OPENERS[open];
    if (!g.close) return [open, spaces ? ' ' : '', this.printNodes(g.children, open)];
    const items = this.splitItems(g.children);
    if (!items.length) return open + close;
    const separator = spaces ? line : softline;
    // Like Prettier, keep an object expanded if the source started it on a new line.
    const expand = g.kind === 'object' && !this.flattened && newlinesBefore(g.children[0]) > 0;
    return group([open, indent([separator, ...this.printItems(items, open, !this.json)]), separator, close], expand);
  }

  printArguments(g) {
    if (!g.close) return ['(', this.printNodes(g.children, '(')];
    if (g.children.some(c => isPunct(c, ';'))) return ['(', this.printNodes(g.children, '('), ')']; // for (;;)
    const items = this.splitItems(g.children);
    if (!items.length) return '()';
    const containsBlock = nodes => nodes.some(n => n.type === 'group' && (['block', 'class'].includes(n.kind) || containsBlock(n.children)));
    const isFunction = nodes => isGroup(nodes[nodes.length - 1], 'block')
      && nodes.some(n => isName(n, 'function') || isPunct(n, '=>'));
    const huggable = nodes => isFunction(nodes) || (nodes.length === 1 && isGroup(nodes[0], 'object', 'array'));
    const simple = item => !item.comments.length && !containsBlock(item.body);
    const hug = (huggable(items[items.length - 1].body) && !items[items.length - 1].comments.length
        && items.slice(0, -1).every(simple))
      || (items.length > 1 && isFunction(items[0].body) && !items[0].comments.length && items.slice(1).every(simple));
    if (hug) {
      const parts = ['('];
      items.forEach((item, i) => parts.push(i ? ', ' : '', this.printNodes(item.body, '(')));
      return [...parts, ')'];
    }
    return group(['(', indent([softline, ...this.printItems(items, '(', false)]), softline, ')']);
  }

  printGroup(g) {
    switch (g.kind) {
      case 'block':
      case 'class': {
        if (!g.children.length) return g.close ? '{}' : '{';
        return ['{', indent([hardline, ...this.printBody(g.children)]), hardline, g.close ? '}' : ''];
      }
      case 'object': return this.printList(g, true);
      case 'array': return this.printList(g, false);
      case 'index': return ['[', this.printNodes(g.children, '['), g.close ? ']' : ''];
      default: return this.printArguments(g);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry points

function compiles(code) {
  for (const source of [code, `(async function () {\n${code}\n})`]) {
    try {
      new vm.Script(source); // Compiles only; nothing is run.
      return true;
    } catch {
      // Try the next wrapping.
    }
  }
  return false;
}

// Ignore what formatting may legitimately add or drop: trailing commas.
function sameTokens(a, b) {
  const significant = tokens => tokens.filter((t, k) => {
    if (!isPunct(t, ',')) return true;
    let j = k + 1;
    while (tokens[j]?.type === 'comment') j++;
    return !(isPunct(tokens[j]) && CLOSERS.has(tokens[j].value));
  }).map(t => `${t.type}\0${t.value}`);
  const x = significant(a), y = significant(b);
  return x.length === y.length && x.every((v, k) => v === y[k]);
}

function formatJs(code, width = 80) {
  const flattened = !code.trim().includes('\n');
  const tokens = tokenize(code, flattened);
  if (!tokens.length) return { code, valid: true };
  const printer = new Printer({ flattened, json: false });
  const doc = printer.printBody(buildTree(tokens, 'program').children);
  propagateBreaks(doc);
  const formatted = printDoc(doc, width);
  if (!sameTokens(tokens, tokenize(formatted, false))) return { code, skipped: 'formatting would change tokens' };
  const valid = compiles(formatted);
  // A minimal rewrite (comments ended, nothing else moved) is the baseline.
  const baseline = tokens.map(t => t.value + (isLineComment(t) ? '\n' : ' ')).join('');
  if (!valid && compiles(baseline)) return { code, skipped: 'formatting would break the syntax' };
  return { code: formatted, valid };
}

const JSON_TOKEN = t => ['str', 'num'].includes(t.type) || isName(t, 'true', 'false', 'null')
  || isPunct(t, '{', '}', '[', ']', ',', ':', '-');

// Returns null when the text is not JSON-shaped.
function formatJson(code, width = 80) {
  const tokens = tokenize(code, !code.trim().includes('\n'));
  if (!tokens.length || !tokens.every(JSON_TOKEN) || !isPunct(tokens[0], '{', '[')) return null;
  const printer = new Printer({ flattened: true, json: true });
  const doc = printer.printNodes(buildTree(tokens, 'json').children);
  propagateBreaks(doc);
  const formatted = printDoc(doc, width);
  if (!sameTokens(tokens, tokenize(formatted, false))) return null;
  return { code: formatted, valid: (() => { try { JSON.parse(formatted); return true; } catch { return false; } })() };
}

module.exports = { formatJs, formatJson, tokenize, compiles, COMMENT_END };
