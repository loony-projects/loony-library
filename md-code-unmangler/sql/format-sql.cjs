'use strict';

/**
 * SQL formatter for the cleaner's --lang sql step, in the style The Art of
 * PostgreSQL uses: one clause per line with the clause keywords right-aligned
 * on a common column (the "river"), joins under the first table, subqueries
 * and $$ function bodies indented, and lists broken one item per line only when
 * they don't fit the width. PDF extraction flattened most listings onto one line
 * and left the listing's line numbers in the code (`order by date 10 )`); a
 * number is removed only where SQL cannot have one. Every result is checked:
 * re-tokenizing it must give the original tokens, minus those line numbers.
 */

// Marks the known end of a `--` comment (the Markdown step knows it from italics).
const COMMENT_END = '\u0001';

// Words after which a number is ordinary SQL (`limit 3`, `order by 2`, `then 0`).
const TAKES_NUMBER = new Set(('limit offset first next by between and or not then else when in is select values '
  + 'return returning case where on having to with from for at interval array distinct exists like ilike similar '
  + 'escape any all some cost rows default start increment minvalue maxvalue cache restart if elsif while using '
  + 'fetch move absolute relative forward backward perform raise exit continue').split(' '));
// Words that a number cannot be an alias for (`1 as x`, `2 desc`, `3 rows`).
const KEYWORDS = new Set(('as and or from where desc asc nulls then else end when is not in like ilike between '
  + 'preceding following rows range row only over filter within order group limit offset union except intersect '
  + 'join on using left right inner outer cross full natural into values select returning having window collate '
  + 'for to escape similar fetch first next null default cycle loop do '
  + 'day days hour hours minute minutes second seconds week weeks month months year years').split(' '));

// Column constraints, which can follow a number only as in `default 0 not null`.
const DDL_AFTER_DEFAULT = new Set(['unique', 'primary', 'references', 'check', 'constraint', 'not', 'null', 'exclude']);

// Clause keywords of a query, longest phrase first. The river aligns those of
// at most RIVER_MAX characters; longer ones (`insert into`) start at the indent.
const CLAUSES = [
  'with recursive', 'with', 'select', 'into', 'from', 'where', 'group by', 'having', 'window', 'order by', 'limit',
  'offset', 'fetch', 'for update', 'for no key update', 'for share', 'for key share', 'union all', 'union distinct',
  'union', 'intersect all', 'intersect', 'except all', 'except', 'insert into', 'values', 'update', 'set',
  'delete from', 'on conflict', 'do update', 'do nothing', 'returning',
].map(phrase => phrase.split(' ')).sort((a, b) => b.length - a.length);
const RIVER_MAX = 8;
// Statements whose query is indented under their opening words.
const PREFIXES = new Set(['create', 'for', 'foreach', 'explain', 'return', 'perform', 'prepare', 'open', 'copy']);
const QUERY_STARTS = new Set(['with', 'with recursive', 'select', 'values', 'insert into', 'update', 'delete from']);
const SET_OPS = new Set(['union', 'intersect', 'except']);
const LIST_CLAUSES = new Set(['select', 'group by', 'order by', 'returning', 'values', 'set', 'with', 'with recursive',
  'window', 'into']);
const JOINS = ['', 'natural '].flatMap(n => ['', 'inner ', 'cross ', 'left ', 'right ', 'full ', 'left outer ',
  'right outer ', 'full outer '].map(kind => `${n}${kind}join`.split(' '))).sort((a, b) => b.length - a.length);
// Where a psql meta-command such as `\set n 1` ends when its line break is lost.
const META_END = new Set(['select', 'insert', 'update', 'delete', 'create', 'alter', 'drop', 'begin', 'commit',
  'rollback', 'truncate', 'table', 'values', 'explain']);
// A `--` comment with no known end stops before a line number and a new statement.
const LINE_COMMENT_GUESS = /\s\d+\s+(?=--|\\[a-z]|(?:select|with|insert|update|delete|create|alter|drop|begin|commit|end|return)\b)/i;

const isWord = (n, ...values) => Boolean(n) && n.type === 'word' && (!values.length || values.includes(n.value.toLowerCase()));
const isPunct = (n, value) => Boolean(n) && n.type === 'punct' && n.value === value;
const lower = n => (n && n.type === 'word' ? n.value.toLowerCase() : '');

// ---------------------------------------------------------------------------
// Tokenizer

// Splits PostgreSQL (and psql meta-commands) into tokens. A $$-quoted body is
// tokenized too, so function bodies can be formatted; one that does not
// tokenize stays an opaque string. Throws on an unterminated string.
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]) || text[i] === COMMENT_END) { i++; continue; }
    const space = i > 0 && /[\s\u0001]/.test(text[i - 1]);
    const rest = text.slice(i);
    const push = (type, value, extra) => { tokens.push({ type, value, space, ...extra }); i += value.length; };
    let m;
    if (rest.startsWith('--')) {
      let end = rest.search(/[\n\u0001]/);
      if (end === -1) {
        const guess = rest.search(LINE_COMMENT_GUESS);
        end = guess === -1 ? rest.length : guess;
      }
      tokens.push({ type: 'comment', value: rest.slice(0, end).trimEnd(), space });
      i += end;
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const length = end === -1 ? rest.length : end + 2;
      tokens.push({ type: 'comment', block: true, value: rest.slice(0, length).trimEnd(), space });
      i += length;
    } else if ((m = /^(?:[EeBbXxNn]|[Uu]&)?'/.exec(rest))) {
      const escapes = /^[Ee]/.test(m[0]);
      let j = m[0].length;
      // A string still open at the end continues on the next page.
      for (; j < rest.length; j++) {
        if (escapes && rest[j] === '\\') j++;
        else if (rest[j] === "'" && rest[j + 1] === "'") j++;
        else if (rest[j] === "'") break;
      }
      push('string', rest.slice(0, j + 1));
    } else if ((m = /^\$\d+/.exec(rest))) {
      push('param', m[0]);
    } else if ((m = /^\$(?:[A-Za-z_]\w*)?\$/.exec(rest))) {
      const tag = m[0];
      const end = rest.indexOf(tag, tag.length);
      const last = tokens[tokens.length - 1];
      if (end === -1 && !isWord(last, 'as', 'do')) {
        // The end of a body that started on the previous page.
        push('tag', tag);
        continue;
      }
      // A body still open at the end continues on the next page.
      const raw = rest.slice(tag.length, end === -1 ? undefined : end);
      let body = null;
      try { body = tokenize(raw); } catch { body = null; }
      tokens.push({ type: 'dollar', value: tag, raw, body, closed: end !== -1, space });
      i += end === -1 ? rest.length : end + tag.length;
    } else if ((m = /^"(?:[^"]|"")*"/.exec(rest))) {
      push('qident', m[0]);
    } else if (rest[0] === '"') {
      throw new Error('unterminated quoted identifier');
    } else if ((m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
      push('number', m[0]);
    } else if ((m = /^(?:::|:=)/.exec(rest))) {
      push('op', m[0]);
    } else if ((m = /^:(?:'[^']*'|"[^"]*"|[A-Za-z_]\w*)/.exec(rest))) {
      push('param', m[0]);
    } else if ((m = /^\\[A-Za-z]+[+!]?/.exec(rest))) {
      push('meta', m[0]);
    } else if ((m = /^[A-Za-z_À-￿][\w$À-￿]*/.exec(rest))) {
      push('word', m[0]);
    } else if ((m = /^[+\-*/<>=~!@#%^&|`?]+/.exec(rest))) {
      let op = m[0];
      const cut = op.slice(1).search(/--|\/\*/);
      if (cut !== -1) op = op.slice(0, cut + 1);
      // As in PostgreSQL, `=-1` is `=` then `-1`: a multi-character operator
      // ends in + or - only if it also has one of ~ ! @ # % ^ & | ` ?.
      while (op.length > 1 && /[+-]$/.test(op) && !/[~!@#%^&|`?]/.test(op)) op = op.slice(0, -1);
      push('op', op);
    } else if (/[()[\],;.:]/.test(rest[0])) {
      push('punct', rest[0]);
    } else {
      push('other', rest[0]);
    }
  }
  return tokens;
}

// Removes the listing's line numbers: a bare integer where SQL cannot have one,
// such as before a name (`, 4 surname`, `from 3 date_trunc(`), after a name, a
// `)` or a `;` (`date 10 )`, `lag(x, 1) 7 over`), or before a $$ body or subquery.
// Two numbers in a row mark a blank line, which is kept as `blankBefore`.
function removeLineNumbers(tokens) {
  let removed = 0;
  const kept = [];
  let lastRemoved = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // `'{ "colors":["White"] 7 }'`: a line number inside JSON in a string.
    if (t.type === 'string' && /^'[[{]/.test(t.value)) {
      const json = t.value.replace(/([\]}"])\s+\d+(?=\s+[\]}"])/g, (_, c) => { removed++; return c; });
      t.value = json;
    }
    if (t.type === 'dollar' && t.body) {
      const inner = removeLineNumbers(t.body);
      t.body = inner.tokens;
      removed += inner.removed;
    }
    if (t.type === 'number' && /^\d+$/.test(t.value) && isLineNumber(kept, tokens, i)) {
      removed++;
      if (tokens[i + 1]) {
        tokens[i + 1].lineHint = true;
        if (lastRemoved) tokens[i + 1].blankBefore = true;
      }
      lastRemoved = true;
      continue;
    }
    lastRemoved = false;
    kept.push(t);
  }
  return { tokens: kept, removed };
}

const isInteger = t => Boolean(t) && t.type === 'number' && /^\d+$/.test(t.value);

function isLineNumber(kept, tokens, i) {
  const prev = kept[kept.length - 1];
  const next = tokens[i + 1];
  if (!prev) return Boolean(next);
  // In a run of integers (`, 24 25 exclude`, `limit 3 31 )`), only the first can
  // be SQL: it is a line number too if the run counts up or if what follows the
  // run says so. The rest are removed as they come (their previous token is a number).
  if (isInteger(next)) {
    if (Number(next.value) === Number(tokens[i].value) + 1) return true;
    let j = i + 1;
    while (isInteger(tokens[j])) j++;
    return isLineNumber(kept, [...tokens.slice(0, i + 1), tokens[j]], i);
  }
  // `\set n 1`: a meta-command's argument.
  if (kept[kept.length - 2] && kept[kept.length - 2].type === 'meta') return false;
  // Only an alias could follow a number directly, and listings don't write `1 one`;
  // nor can a bracket or a column constraint (`8 (`, `, 8 unique(`).
  if (isWord(next) && !KEYWORDS.has(lower(next)) && !(DDL_AFTER_DEFAULT.has(lower(next)) && isWord(prev, 'default'))) return true;
  if (isPunct(next, '(')) return true;
  if (prev.type === 'comment' || isPunct(prev, ';') || isPunct(prev, ')') || isPunct(prev, ']')) return true;
  if (['number', 'string', 'qident', 'param', 'dollar'].includes(prev.type)) return true;
  if (prev.type === 'word') return !TAKES_NUMBER.has(lower(prev));
  if (isPunct(prev, ',') || isPunct(prev, '(')) {
    return Boolean(next) && (['dollar', 'string', 'qident'].includes(next.type) || (isPunct(prev, '(') && isWord(next, 'select', 'with')));
  }
  return false;
}

// Nests ( ) and [ ] into groups; an unmatched bracket stays a plain token.
function group(tokens) {
  const root = [];
  const stack = [root];
  const open = [];
  for (const t of tokens) {
    if (t.type === 'punct' && (t.value === '(' || t.value === '[')) {
      const g = { type: 'group', open: t.value, close: null, children: [], space: t.space,
        lineHint: t.lineHint, blankBefore: t.blankBefore };
      stack[stack.length - 1].push(g);
      stack.push(g.children);
      open.push(g);
    } else if (t.type === 'punct' && open.length && t.value === (open[open.length - 1].open === '(' ? ')' : ']')) {
      open.pop().close = t.value;
      stack.pop();
    } else stack[stack.length - 1].push(t);
  }
  return root;
}

function flatten(tokens, out = []) {
  for (const t of tokens) {
    if (t.type === 'dollar') {
      out.push(t.value);
      if (t.body) flatten(t.body, out);
      else out.push(`raw:${t.raw.replace(/\s+/g, ' ').trim()}`);
      if (t.closed) out.push(t.value);
    } else out.push(`${t.type}:${t.type === 'comment' ? t.value.replace(/\s+/g, ' ') : t.value}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output

class Writer {
  constructor(width) { this.width = width; this.lines = []; this.line = ''; }
  text(s, space) {
    if (space && /\S$/.test(this.line)) this.line += ' ';
    this.line += s;
  }
  // Ends the current line (unless it is empty) and starts one with this prefix.
  start(prefix = '') {
    if (this.line.trim()) this.lines.push(this.line.trimEnd());
    this.line = prefix;
  }
  newline(col) { this.start(' '.repeat(col)); }
  blank() {
    this.start();
    if (this.lines.length && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }
  finish() { this.start(); return this.lines; }
}

const indentOf = line => line.length - line.trimStart().length;

function spaceBefore(prev, n) {
  if (!prev) return true;
  if (n.type === 'punct' && [',', ';', ')', ']', '.', ':'].includes(n.value)) return false;
  if (isPunct(prev, '.') || isPunct(prev, ':')) return false;
  if (n.value === '::' || prev.value === '::') return false;
  // Keep the author's spacing around brackets and operators: `using(id)` but `in (...)`.
  if (n.type === 'group' || n.type === 'op' || prev.type === 'op') return n.space;
  if (prev.type === 'meta') return true;
  return true;
}

// A block comment written as ` * `-prefixed lines (`/* * a * b */`).
const isStarComment = n => n.block && /^\/\*\s*\*\s/.test(n.value);
function starCommentLines(value) {
  const closed = value.endsWith('*/');
  const body = value.slice(2, closed ? -2 : undefined);
  const lines = body.split(/\s+\*(?=\s|$)/).map(s => s.trim());
  if (!lines[0]) lines.shift();
  return ['/*', ...lines.map(s => (s ? ` * ${s}` : ' *')), ...(closed ? [' */'] : [])];
}

// The nodes on one line, or null if they must break (a line comment or $$ body).
function inline(nodes) {
  let out = '';
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    let piece;
    if (n.type === 'comment') {
      if (!n.block || isStarComment(n)) return null;
      piece = n.value;
    } else if (n.type === 'group') {
      const inner = inline(n.children);
      if (inner === null) return null;
      piece = n.open + inner + (n.close || '');
    } else if (n.type === 'dollar') {
      if (n.body && n.body.length) return null;
      piece = n.value + (n.body ? '' : n.raw) + (n.closed ? n.value : '');
    } else piece = n.value;
    out += (k && spaceBefore(nodes[k - 1], n) ? ' ' : '') + piece;
  }
  return out;
}

function fits(nodes, w, space = true) {
  const text = inline(nodes);
  return text !== null && w.line.length + (space ? 1 : 0) + text.length <= w.width;
}

// Splits nodes at top-level commas, keeping each comma with the item before it.
function splitCommas(nodes) {
  const items = [[]];
  for (const n of nodes) {
    items[items.length - 1].push(n);
    if (isPunct(n, ',')) items.push([]);
  }
  return items.filter(item => item.length);
}

// Splits a condition before each top-level `and`/`or`, but not `between x and y`.
function splitConditions(nodes) {
  const items = [[]];
  let between = false;
  for (const n of nodes) {
    if (isWord(n, 'between')) between = true;
    else if (isWord(n, 'and') && between) between = false;
    else if (isWord(n, 'and', 'or') && items[items.length - 1].length) items.push([]);
    items[items.length - 1].push(n);
  }
  return items;
}

const matchPhrase = (nodes, i, phrases) =>
  phrases.find(words => words.every((word, k) => isWord(nodes[i + k], word))) || null;

// Writes nodes, breaking only where needed: a line comment ends its line, and a
// bracket group that does not fit breaks one item per line (a subquery as a block).
// `col` is where continuation lines start.
function renderNodes(nodes, w, col, firstSpace = true) {
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const space = k ? spaceBefore(nodes[k - 1], n) : firstSpace;
    if (n.type === 'comment') {
      if (isStarComment(n)) {
        w.newline(col);
        for (const line of starCommentLines(n.value)) { w.text(line, false); w.newline(col); }
      } else {
        w.text(n.value, true);
        if (!n.block) w.newline(col);
      }
    } else if (n.type === 'group') {
      // A subquery also breaks when what follows it on the line would not fit.
      const comma = nodes.findIndex((m, j) => j > k && isPunct(m, ','));
      const tail = inline(nodes.slice(k + 1, comma === -1 ? nodes.length : comma + 1));
      renderGroup(n, w, col, space, tail === null ? 0 : tail.length + 1);
    }
    else if (n.type === 'dollar') renderDollar(n, w, space);
    else if (isWord(n, 'case')) k = renderCase(nodes, k, w, space);
    else w.text(n.value, space);
  }
}

// `case ... end` on one line if it fits; otherwise each `when`, `then` and
// `else` on its own line under `case`, and `end` below it. Returns the index of `end`.
function renderCase(nodes, k, w, space) {
  let end = k + 1;
  for (let depth = 1; end < nodes.length; end++) {
    if (isWord(nodes[end], 'case')) depth++;
    else if (isWord(nodes[end], 'end') && --depth === 0) break;
  }
  const whole = nodes.slice(k, end + 1);
  if (fits(whole, w, space)) {
    w.text(inline(whole), space);
    return end;
  }
  w.text(nodes[k].value, space);
  const col = w.line.length - nodes[k].value.length;
  const parts = [[]];
  let depth = 0;
  for (const n of nodes.slice(k + 1, end)) {
    if (isWord(n, 'case')) depth++;
    else if (isWord(n, 'end')) depth--;
    else if (!depth && isWord(n, 'when', 'then', 'else') && parts[parts.length - 1].length) parts.push([]);
    parts[parts.length - 1].push(n);
  }
  parts.forEach((part, i) => {
    if (i || isWord(part[0], 'when', 'then', 'else')) w.newline(col + 2);
    renderNodes(part, w, col + 4);
  });
  if (end < nodes.length) {
    w.newline(col);
    w.text(nodes[end].value, false);
  }
  return end;
}

function isQuery(nodes) {
  const first = nodes.find(n => n.type !== 'comment');
  const clauses = splitClauses(nodes);
  return Boolean(first) && clauses[0].words[0] === first && QUERY_STARTS.has(clauses[0].key);
}

function renderGroup(g, w, col, space, tail = 0) {
  const text = inline([g]);
  const query = g.open === '(' && isQuery(g.children);
  if (text !== null && (!g.children.length || w.line.length + (space ? 1 : 0) + text.length + (query ? tail : 0) <= w.width)) {
    w.text(text, space);
    return;
  }
  if (query) {
    w.text('(', space);
    w.start();
    layoutStatement(g.children, w, col + 2);
    w.newline(col);
    if (g.close) w.text(g.close, false);
    return;
  }
  const base = indentOf(w.line);
  w.text(g.open, space);
  for (const item of splitCommas(g.children)) {
    w.newline(base + 2);
    renderNodes(item, w, base + 2);
  }
  w.newline(base);
  if (g.close) w.text(g.close, false);
}

// A $$ function body is formatted as a script and indented under the statement.
function renderDollar(d, w, space) {
  if (!d.body || !d.body.length) {
    w.text(d.value + (d.body ? '' : d.raw) + (d.closed ? d.value : ''), space);
    return;
  }
  const base = indentOf(w.line);
  w.text(d.value, space);
  w.start();
  formatScript(group(d.body), w, base + 2);
  if (d.closed) w.start(' '.repeat(base) + d.value);
}

// ---------------------------------------------------------------------------
// Statements

// `with name as (`, `with name(a, b) as materialized (`, `with recursive name`.
function cteAt(nodes, i) {
  let j = i + 1;
  if (isWord(nodes[j], 'recursive')) j++;
  if (!(isWord(nodes[j]) || (nodes[j] && nodes[j].type === 'qident'))) return false;
  j++;
  if (nodes[j] && nodes[j].type === 'group') j++;
  return isWord(nodes[j], 'as');
}

// Splits a statement into clauses. Nodes before the first clause become a
// clause with no keyword (`create view v as`, `for rec in`, a comment).
function splitClauses(nodes) {
  const clauses = [{ key: null, words: [], rest: [] }];
  const seen = [];
  for (let i = 0; i < nodes.length; i++) {
    const phrase = matchPhrase(nodes, i, CLAUSES);
    const key = phrase && phrase.join(' ');
    const last = seen[seen.length - 1];
    const ok = key && ({
      with: () => cteAt(nodes, i), 'with recursive': () => cteAt(nodes, i),
      into: () => seen.includes('select'),
      from: () => !isWord(nodes[i - 1], 'distinct'),
      update: () => !seen.length || last === 'with' || last === 'with recursive',
      set: () => last === 'update' || last === 'do update',
      values: () => !isWord(nodes[i - 1], 'default'),
      fetch: () => isWord(nodes[i + 1], 'first', 'next'),
      'do update': () => last === 'on conflict', 'do nothing': () => last === 'on conflict',
    }[key] || (() => true))();
    if (!ok) {
      clauses[clauses.length - 1].rest.push(nodes[i]);
      continue;
    }
    clauses.push({ key, words: nodes.slice(i, i + phrase.length), rest: [] });
    seen.push(key);
    i += phrase.length - 1;
  }
  if (!clauses[0].rest.length) clauses.shift();
  return clauses;
}

// Statements that are not queries even when they contain a clause keyword
// (`grant select on`, `copy t from`, `create index ... where`).
const NOT_QUERIES = new Set(['create', 'alter', 'drop', 'grant', 'revoke', 'copy', 'comment', 'set', 'reset', 'begin',
  'commit', 'rollback', 'truncate', 'vacuum', 'analyze', 'listen', 'notify', 'lock', 'do', 'declare']);

function layoutStatement(nodes, w, indent) {
  const clauses = splitClauses(nodes);
  const first = clauses.find(c => c.key);
  const opening = lower(nodes.find(n => n.type !== 'comment'));
  // A listing continued from the previous page can start mid-query (`) as x from`).
  if (first && (QUERY_STARTS.has(first.key) || !NOT_QUERIES.has(opening))) layoutQuery(clauses, w, indent);
  else layoutOther(nodes, w, indent);
}

function layoutQuery(clauses, w, indent) {
  // `insert into t values (...)` stays on one line when it fits.
  if (clauses.length === 2 && clauses[0].key === 'insert into' && clauses[1].key === 'values') {
    const nodes = clauses.flatMap(c => [...c.words, ...c.rest]);
    const text = inline(nodes);
    if (text !== null && indent + text.length <= w.width) {
      w.start(' '.repeat(indent) + text);
      return;
    }
  }
  if (!clauses[0].key) {
    const prefix = clauses.shift().rest;
    w.newline(indent);
    renderList(prefix, w, indent + 2, 'comma');
    // `create view v as`, `for rec in`: the query goes under the prefix.
    if (PREFIXES.has(lower(prefix.find(n => n.type !== 'comment')))) indent += 2;
  }
  const text = c => c.words.map(n => n.value).join(' ');
  const river = Math.max(0, ...clauses.filter(c => !SET_OPS.has(c.key.split(' ')[0]) && text(c).length <= RIVER_MAX)
    .map(c => text(c).length));
  for (const c of clauses) {
    const keyword = text(c);
    const pad = keyword.length <= river ? indent + river - keyword.length : indent;
    w.start(' '.repeat(pad) + keyword);
    const col = pad + keyword.length + 1;
    if (!c.rest.length) continue;
    if (c.key === 'from') {
      const segments = [[]];
      for (let i = 0; i < c.rest.length; i++) {
        const join = matchPhrase(c.rest, i, JOINS);
        if (join && i) segments.push([]);
        const length = join ? join.length : 1;
        segments[segments.length - 1].push(...c.rest.slice(i, i + length));
        i += length - 1;
      }
      renderList(segments[0], w, col, 'comma');
      for (const segment of segments.slice(1)) {
        w.newline(col);
        renderJoin(segment, w, col);
      }
    } else if (c.key === 'where' || c.key === 'having') renderList(c.rest, w, col, 'conditions', indent + river);
    else if (LIST_CLAUSES.has(c.key)) renderList(c.rest, w, col, 'comma');
    else renderNodes(c.rest, w, col);
  }
}

// `join t on a = b and c = d` on one line if it fits; otherwise the condition
// goes below, with `and`/`or` aligned under `on`.
function renderJoin(nodes, w, col) {
  const on = nodes.findIndex(n => isWord(n, 'on'));
  if (fits(nodes, w, false) || on <= 0) return renderNodes(nodes, w, col + 2);
  renderNodes(nodes.slice(0, on), w, col + 2);
  w.newline(col + 2);
  w.text(nodes[on].value, false);
  renderList(nodes.slice(on + 1), w, col + 5, 'conditions', col + 4);
}

// One line if it fits; otherwise one item per line, `and`/`or` on the river.
function renderList(nodes, w, col, mode, riverEnd) {
  if (fits(nodes, w)) return renderNodes(nodes, w, col);
  const items = mode === 'comma' ? splitCommas(nodes) : splitConditions(nodes);
  items.forEach((item, k) => {
    if (k) {
      if (mode === 'comma') w.newline(col);
      else w.newline(Math.max(0, riverEnd - item[0].value.length));
    }
    renderNodes(item, w, col);
  });
}

// Other statements (DDL, transaction control, psql): one line, with bracket
// groups broken as needed; a function definition puts its options on lines,
// and a trigger that does not fit puts each part on its own line.
function layoutOther(nodes, w, indent) {
  const isFunction = nodes.slice(0, 5).some(n => isWord(n, 'function', 'procedure'));
  const isTrigger = nodes.slice(0, 4).some(n => isWord(n, 'trigger')) && !fits(nodes, { line: ' '.repeat(indent), width: w.width }, false);
  const segments = [[]];
  nodes.forEach((n, i) => {
    const option = (isFunction && i && (isWord(n, 'returns', 'language')
      || (isWord(n, 'as') && nodes[i + 1] && nodes[i + 1].type === 'dollar')))
      || (isTrigger && isWord(n, 'before', 'after', 'instead', 'on', 'for', 'execute', 'when')
        && !isWord(nodes[i - 1], 'for', 'instead', 'each'));
    if (option) segments.push([]);
    segments[segments.length - 1].push(n);
  });
  segments.forEach((segment, k) => {
    w.newline(indent + (isTrigger && k ? 2 : 0));
    renderList(segment, w, indent + 2, 'comma');
  });
}

// Formats a sequence of statements: a whole listing, or a $$ function body,
// where PL/pgSQL blocks (declare, begin ... end, loop, if) are indented.
function formatScript(nodes, w, indent) {
  const stack = [];
  const current = () => (stack.length ? stack[stack.length - 1].inner : indent);
  const until = (i, stop) => {
    let j = i;
    while (j < nodes.length && !stop(nodes[j], j)) j++;
    return j;
  };
  const statementEnd = i => {
    const loopHead = isWord(nodes[i], 'for', 'foreach', 'while', 'loop');
    const j = until(i, (n, k) => isPunct(n, ';') || (loopHead && isWord(n, 'loop') && !isWord(nodes[k - 1], 'end')));
    return Math.min(j + 1, nodes.length);
  };
  let first = true;

  for (let i = 0; i < nodes.length;) {
    const n = nodes[i];
    if (n.blankBefore && !first) w.blank();
    first = false;
    const word = lower(n);
    const top = stack[stack.length - 1];

    if (n.type === 'comment') {
      w.newline(current());
      renderNodes([n], w, current());
      i++;
    } else if (n.type === 'tag') {
      // The closing $$ of a body from the previous page ends the body's indentation.
      w.newline(Math.max(0, indent - 2));
      const end = statementEnd(i);
      renderNodes(nodes.slice(i, end), w, indent);
      i = end;
    } else if (n.type === 'meta') {
      const end = until(i + 1, m => m.lineHint || m.type === 'meta' || isPunct(m, ';') || META_END.has(lower(m)));
      w.newline(current());
      w.text(inline(nodes.slice(i, end)) || n.value, false);
      i = end;
    } else if (word === 'declare' && !nodes.slice(i, statementEnd(i)).some(m => isWord(m, 'cursor'))) {
      w.newline(current());
      w.text(n.value, false);
      stack.push({ kind: 'declare', outer: current(), inner: current() + 2 });
      i++;
    } else if (word === 'begin' && !isPunct(nodes[i + 1], ';') && !isWord(nodes[i + 1], 'transaction', 'work', 'isolation')) {
      if (top && top.kind === 'declare') stack.pop();
      w.newline(current());
      w.text(n.value, false);
      stack.push({ kind: 'begin', outer: current(), inner: current() + 2 });
      i++;
    } else if (word === 'end' && stack.length) {
      while (stack.length && stack[stack.length - 1].kind === 'when') stack.pop();
      const block = stack.pop();
      const end = statementEnd(i);
      w.newline(block.outer);
      w.text(inline(nodes.slice(i, end)) || n.value, false);
      i = end;
    } else if (word === 'exception' && stack.some(b => b.kind === 'begin')) {
      while (stack[stack.length - 1].kind !== 'begin') stack.pop();
      w.newline(stack[stack.length - 1].outer);
      w.text(n.value, false);
      i++;
    } else if ((word === 'when' && top && (top.kind === 'begin' || top.kind === 'when'))
        || ((word === 'elsif' || word === 'elseif' || word === 'else') && top && top.kind === 'if')
        || (word === 'if' && stack.length)) {
      if (word === 'when' && top.kind === 'when') stack.pop();
      const end = word === 'else' ? i + 1 : Math.min(until(i, m => isWord(m, 'then')) + 1, nodes.length);
      const reopen = word !== 'if' && word !== 'when';
      w.newline(reopen ? top.outer : current());
      renderNodes(nodes.slice(i, end), w, current() + 4, false);
      if (!reopen) stack.push({ kind: word === 'if' ? 'if' : 'when', outer: current(), inner: current() + 2 });
      i = end;
    } else {
      const end = statementEnd(i);
      const statement = nodes.slice(i, end);
      const loop = isWord(statement[statement.length - 1], 'loop') && statement.length > 1;
      if (loop) {
        // `for rec in select ... loop`: the query, then `loop` on its own line.
        layoutStatement(statement.slice(0, -1), w, current());
        w.newline(current());
        w.text(statement[statement.length - 1].value, false);
      } else layoutStatement(statement, w, current());
      if (isWord(statement[statement.length - 1], 'loop')) {
        stack.push({ kind: 'loop', outer: current(), inner: current() + 2 });
      }
      i = end;
    }
  }
}

// ---------------------------------------------------------------------------

function render(tokens, width) {
  const w = new Writer(width);
  formatScript(group(tokens), w, 0);
  return w.finish().join('\n');
}

function sameTokens(expected, code) {
  let actual;
  try { actual = flatten(tokenize(code)); } catch { return false; }
  return actual.length === expected.length && actual.every((t, k) => t === expected[k]);
}

// Formats flattened SQL. Returns { code, removed } where removed counts the
// listing line numbers taken out, plus `skipped` with a reason when the code
// could not be formatted safely and is returned on one line instead.
function formatSql(source, width = 80) {
  let tokens;
  try {
    tokens = tokenize(source);
  } catch (error) {
    return { code: source.replace(new RegExp(COMMENT_END, 'g'), '\n').trim(), removed: 0, skipped: error.message };
  }
  const result = removeLineNumbers(tokens);
  const expected = flatten(result.tokens);
  const code = render(result.tokens, width);
  if (sameTokens(expected, code)) return { code, removed: result.removed };
  const fallback = render(result.tokens, Infinity);
  return {
    code: sameTokens(expected, fallback) ? fallback : source.replace(new RegExp(COMMENT_END, 'g'), '\n').trim(),
    removed: result.removed, skipped: 'formatting would change the code',
  };
}

module.exports = { formatSql, tokenize, removeLineNumbers, COMMENT_END };
