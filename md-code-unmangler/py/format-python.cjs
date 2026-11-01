'use strict';

/**
 * Step 2 of the Python cleaner (`node cleaner/index.cjs --lang py`, or `--format` alone), after
 * clean-markdown.cjs. Only ```py / ```python fenced blocks are touched;
 * they are reformatted in the spirit of Prettier/Black: one statement per line,
 * 4-space indentation, normalized spacing, and long lines wrapped at brackets.
 * The PDF extraction flattened most listings onto a single line, so statement
 * breaks and indentation are reconstructed heuristically. Dedents cannot be
 * recovered from flattened text (e.g. code after a loop body), so review output.
 * A block is left unchanged when it looks like printed output (`grad_fn=<...>`)
 * or when re-tokenizing the result would not reproduce the original tokens.
 */

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else '
  + 'except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield').split(' '));
// Keywords that behave like values: they end an expression.
const VALUE_KEYWORDS = new Set(['True', 'False', 'None', 'pass', 'break', 'continue']);
const BLOCK_KEYWORDS = new Set(['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'def', 'class']);
const STATEMENT_KEYWORDS = new Set(['def', 'class', 'return', 'import', 'raise', 'assert', 'del', 'pass', 'break',
  'continue', 'global', 'nonlocal', 'while', 'with', 'try', 'except', 'finally', 'elif', 'for', 'async']);
const INFIX_KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'as', 'lambda']);
const DEDENT_AFTER = new Set(['return', 'raise', 'break', 'continue', 'pass']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);
const UNARY = new Set(['-', '+', '~', '*', '**']);
const OPERATORS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '<<', '>>'];

const isOp = (t, value) => Boolean(t) && t.type === 'op' && (value === undefined || t.value === value);
const isWord = t => Boolean(t) && t.type === 'name' && (!KEYWORDS.has(t.value) || VALUE_KEYWORDS.has(t.value));
const endsExpression = t => t.type === 'number' || t.type === 'string' || isWord(t)
  || (t.type === 'op' && (CLOSERS.has(t.value) || t.value === '...'));
const columns = text => text.replace(/\t/g, '    ').length;

// ---------------------------------------------------------------------------
// Tokenizer

// In flattened code a comment has no line end, so guess where code resumes:
// the first word after the comment's first word that looks like Python.
function resumesCode(word, next, depth) {
  const bare = word.replace(/[,:;)\]}]+$/, '');
  return /^["'[{]/.test(word)
    || (depth > 0 && /^[)\]}]+[,:]?$/.test(word))
    || (/^[A-Za-z_]\w*$/.test(bare) && bare.includes('_'))
    || /^[A-Za-z_][\w.]*\(/.test(word)
    || /^[A-Za-z_]\w+\.[A-Za-z_]\w+/.test(word)
    || /^[A-Za-z_]\w*=[^=]/.test(word)
    || (/^[A-Za-z_]\w*$/.test(bare) && /^(?:[-+*/%@&|^]|\*\*|\/\/)?=$/.test(next || ''))
    || word === 'def';
}

function commentEnd(src, start, depth, flattened) {
  const newline = src.indexOf('\n', start);
  const lineEnd = newline < 0 ? src.length : newline;
  if (!flattened) return lineEnd;
  // A callout marker ("#A", "#B" ... pointing at the book's margin notes) is
  // the whole comment: what follows it is code ("#E return text").
  const callout = /^#[A-Z]{1,2}(?=\s|$)/.exec(src.slice(start, lineEnd));
  if (callout) return start + callout[0].length;
  const words = [...src.slice(start + 1, lineEnd).matchAll(/\S+/g)];
  for (let w = 1; w < words.length; w++) {
    if (resumesCode(words[w][0], words[w + 1]?.[0], depth)) return start + 1 + words[w].index;
  }
  return lineEnd;
}

function tokenize(source, flattened) {
  let src = source;
  const tokens = [];
  const STRING = /([rRbBuUfF]{0,2})('''|"""|'|")/y;
  const NUMBER = /0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?/y;
  const NAME = /[\p{L}_][\p{L}\p{N}_]*/uy;
  let i = 0, space = false, newlines = 0, lineStart = 0, depth = 0;
  function push(type, value, start) {
    const token = { type, value, space, newlines, start, end: start + value.length };
    if (newlines || !tokens.length) token.indent = columns(src.slice(lineStart, start));
    tokens.push(token);
    space = false;
    newlines = 0;
  }
  const at = re => { re.lastIndex = i; return re.exec(src); };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { newlines++; space = true; lineStart = ++i; continue; }
    if (/\s/.test(ch)) { space = true; i++; continue; }
    if (ch === '\\') {
      // Before a line break or space it is a line continuation; anywhere else
      // outside a string it is a Markdown escape left by the PDF extraction.
      if (src[i + 1] === '\n') { space = true; i += 2; lineStart = i; continue; }
      if (i + 1 >= src.length || /\s/.test(src[i + 1])) { space = true; i++; continue; }
      src = src.slice(0, i) + src.slice(i + 1);
      // Re-lex the token just before the escape so `\*\*` and `file\_path` join up.
      const prev = tokens[tokens.length - 1];
      if (prev && !space && prev.end === i && ['name', 'number', 'op'].includes(prev.type)
          && !OPENERS.has(prev.value) && !CLOSERS.has(prev.value)) {
        tokens.pop();
        ({ start: i, space, newlines } = prev);
      }
      continue;
    }
    // Some converters italicize comments: `*# Place all tensors on the device* inputs = ...`.
    // In flattened code the closing `*` marks exactly where the comment ends.
    if (flattened && ch === '*' && src[i + 1] === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      let close = i + 2;
      while (close < src.length && !(src[close] === '*' && src[close - 1] !== '\\' && (close + 1 >= src.length || /\s/.test(src[close + 1])))) close++;
      if (close < src.length) {
        // These books print such comments on their own line above the code
        // they describe, so each starts a line rather than trailing the
        // statement before it. Consecutive comment lines can share one
        // italic span: "*# logit.size: [...] # Predict class ...*".
        for (const part of src.slice(i + 1, close).split(/\s+(?=#\s+[A-Z])/)) {
          push('comment', part.trimEnd(), i);
          tokens[tokens.length - 1].newlines = Math.max(1, tokens[tokens.length - 1].newlines);
        }
        i = close + 1;
        continue;
      }
    }
    if (ch === '#') {
      const end = commentEnd(src, i, depth, flattened);
      push('comment', src.slice(i, end).trimEnd(), i);
      i = end;
      continue;
    }
    const string = at(STRING);
    if (string) {
      const [, prefix, quote] = string;
      let j = i + string[0].length;
      while (j < src.length && !src.startsWith(quote, j)) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n' && quote.length === 1) break;
        j++;
      }
      const end = Math.min(src.length, src.startsWith(quote, j) ? j + quote.length : j);
      let value = src.slice(i, end);
      // Markdown escapes are never meaningful Python escapes outside raw strings.
      if (!/[rR]/.test(prefix)) value = value.replace(/\\([\s\S])/g, (m, c) => ('*_#$'.includes(c) ? c : m));
      push('string', value, i);
      i = end;
      continue;
    }
    const number = /[\d.]/.test(ch) && at(NUMBER);
    if (number) { push('number', number[0], i); i += number[0].length; continue; }
    const name = at(NAME);
    if (name) { push('name', name[0], i); i += name[0].length; continue; }
    const op = OPERATORS.find(o => src.startsWith(o, i)) || ch;
    if (OPENERS.has(op)) depth++;
    else if (CLOSERS.has(op)) depth = Math.max(0, depth - 1);
    push('op', op, i);
    i += op.length;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Statements and indentation

function isBlockStart(tokens) {
  const keyword = tokens[0].value === 'async' ? tokens[1]?.value : tokens[0].value;
  return tokens[0].type === 'name' && BLOCK_KEYWORDS.has(keyword);
}

// `x if c else y` is a conditional expression; `if c:` starts a block.
function isIfStatement(tokens, k) {
  let depth = 0, lambdas = 0;
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === 'op') {
      if (OPENERS.has(t.value)) depth++;
      else if (CLOSERS.has(t.value) && --depth < 0) return false;
      else if (depth === 0 && t.value === ':') { if (!lambdas) return true; lambdas--; }
      else if (depth === 0 && (t.value === '=' || t.value === ';')) return false;
    } else if (depth === 0 && t.type === 'name') {
      if (t.value === 'else') return false;
      if (t.value === 'lambda') lambdas++;
    }
  }
  return false;
}

// Decide whether tokens[k] begins a new statement in flattened code.
function startsStatement(current, tokens, k) {
  const t = tokens[k], prev = current[current.length - 1], first = current[0].value;
  if (t.type === 'op') {
    return t.value === '@' && t.space && tokens[k + 1]?.type === 'name' && !tokens[k + 1].space
      && endsExpression(prev);
  }
  if (t.type !== 'name' || prev.value === 'async') return false;
  switch (t.value) {
    case 'import': return first !== 'from' || current.some(x => x.value === 'import');
    case 'from': return first !== 'raise' && prev.value !== 'yield';
    case 'if': return isIfStatement(tokens, k);
    case 'else': return isOp(tokens[k + 1], ':');
  }
  if (STATEMENT_KEYWORDS.has(t.value)) return true;
  if (INFIX_KEYWORDS.has(t.value)) return false;
  return endsExpression(prev);
}

function splitStatements(tokens, flattened) {
  const statements = [];
  let current = [], depth = 0, lambdas = 0;
  const finish = (header = false) => {
    if (current.length) statements.push({ tokens: current, header });
    current = [];
    lambdas = 0;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (depth === 0 && current.length && (flattened ? startsStatement(current, tokens, k) : t.newlines > 0)) finish();
    if (depth === 0 && t.type === 'comment') {
      // A comment known to start its own line (an italic `*# ...*` comment in
      // flattened code) ends the statement before it instead of trailing it.
      if (current.length && !(flattened && t.newlines)) { current.push(t); finish(); continue; }
      finish();
      const last = statements[statements.length - 1];
      if (last && !t.newlines && last.tokens[last.tokens.length - 1].type !== 'comment') last.tokens.push(t);
      else statements.push({ tokens: [t], header: false, comment: true });
      continue;
    }
    if (t.type === 'op') {
      if (OPENERS.has(t.value)) depth++;
      else if (CLOSERS.has(t.value)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && t.value === ';') { finish(); continue; }
      else if (depth === 0 && t.value === ':') {
        if (lambdas) lambdas--;
        else if (isBlockStart(current)) { current.push(t); finish(true); continue; }
      }
    } else if (depth === 0 && t.value === 'lambda') lambdas++;
    current.push(t);
  }
  finish();
  for (const s of statements) {
    const [first, second] = s.tokens;
    s.keyword = isOp(first, '@') ? '@' : first.type !== 'name' ? '' : first.value === 'async' ? second?.value : first.value;
  }
  return statements;
}

// Flattened code: rebuild indentation from block structure and keyword cues.
function guessLevels(statements) {
  const stack = [];
  let dedent = false, decorator = null;
  const body = () => (stack.length ? stack[stack.length - 1].level + 1 : 0);
  const unwindTo = kinds => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (kinds.includes(stack[i].keyword)) { const { level } = stack[i]; stack.length = i; return level; }
    }
    return stack.length ? stack.pop().level : 0;
  };
  for (const s of statements) {
    if (s.comment) continue;
    const kw = s.keyword;
    let level;
    if (decorator !== null) level = decorator;
    else if (kw === 'elif') level = unwindTo(['if', 'elif']);
    else if (kw === 'else') level = unwindTo(['if', 'elif', 'for', 'while', 'try', 'except']);
    else if (kw === 'except') level = unwindTo(['try', 'except']);
    else if (kw === 'finally') level = unwindTo(['try', 'except', 'else']);
    else if (kw === 'def' || kw === '@') {
      stack.length = stack.map(b => b.keyword).lastIndexOf('class') + 1;
      level = body();
    } else if (kw === 'class') { stack.length = 0; level = 0; }
    else if ((kw === 'import' || kw === 'from') && stack[stack.length - 1]?.keyword !== 'try') {
      stack.length = 0;
      level = 0;
    } else {
      if (dedent) stack.pop();
      // A return directly inside a loop is rare; it usually ends the function.
      if (kw === 'return') while (['for', 'while'].includes(stack[stack.length - 1]?.keyword)) stack.pop();
      level = body();
    }
    dedent = !s.header && DEDENT_AFTER.has(kw);
    decorator = kw === '@' ? level : null;
    if (s.header) stack.push({ keyword: kw, level });
    s.level = level;
  }
}

// Multi-line code: keep the source's indentation structure.
function sourceLevels(statements) {
  let widths = null, previous = null;
  for (const s of statements) {
    if (s.comment) continue;
    const first = s.tokens[0];
    if (previous && !first.newlines) s.level = previous.level + (previous.header ? 1 : 0);
    else {
      const width = first.indent || 0;
      if (!widths) widths = [width];
      while (widths.length > 1 && width < widths[widths.length - 1]) widths.pop();
      if (width > widths[widths.length - 1]) widths.push(width);
      else if (width < widths[0]) widths[0] = width;
      s.level = widths.length - 1;
    }
    previous = s;
  }
}

function placeComments(statements) {
  let next = 0;
  for (let i = statements.length - 1; i >= 0; i--) {
    if (statements[i].comment) statements[i].level = next;
    else next = statements[i].level;
  }
}

// Black-style blank lines: two around top-level def/class, one between methods.
function assignBlankLines(statements, flattened) {
  let previous = null, topKeyword = null;
  statements.forEach((s, i) => {
    s.blank = i && !flattened ? Math.min(2, Math.max(0, s.tokens[0].newlines - 1)) : 0;
    if (s.comment) return;
    let rule = 0;
    if (previous && ['def', 'class', '@'].includes(s.keyword)) rule = s.level === 0 ? 2 : 1;
    else if (previous && s.level === 0 && previous.level > 0 && ['def', 'class'].includes(topKeyword)) rule = 2;
    s.blank = previous && (previous.header || previous.keyword === '@') ? 0 : Math.max(s.blank, rule);
    if (s.level === 0) topKeyword = s.keyword === '@' ? 'def' : s.keyword;
    previous = s;
  });
  // Comments directly above a statement take its blank lines.
  for (let i = 0; i < statements.length; i++) {
    if (!statements[i].comment) continue;
    let j = i;
    while (statements[j]?.comment && (j === i || !statements[j].blank)) j++;
    const target = statements[j];
    if (target && !target.comment && (flattened || target.tokens[0].newlines <= 1)) {
      statements[i].blank = Math.max(statements[i].blank, target.blank);
      target.blank = 0;
    }
    i = j - 1;
  }
}

// ---------------------------------------------------------------------------
// Rendering

function isUnary(tokens, k) {
  const t = tokens[k], prev = tokens[k - 1];
  if (t.type !== 'op' || !UNARY.has(t.value)) return false;
  if (!prev) return true;
  if (prev.type === 'op') return !CLOSERS.has(prev.value) && prev.value !== '...';
  return prev.type === 'name' && !isWord(prev);
}

// Black hugs `**` when both operands are simple: x**2, 2**-n.
function hugsPower(tokens, k) {
  const simple = t => Boolean(t) && (t.type === 'number' || isWord(t));
  return isOp(tokens[k], '**') && !isUnary(tokens, k) && simple(tokens[k - 1])
    && (simple(tokens[k + 1]) || (isOp(tokens[k + 1], '-') && simple(tokens[k + 2])));
}

function spaceBetween(tokens, k, bracket) {
  const prev = tokens[k - 1], t = tokens[k], p = prev.value, v = t.value;
  if (t.type === 'comment') return true;
  if (prev.type === 'op' && OPENERS.has(p)) return false;
  if (t.type === 'op' && (CLOSERS.has(v) || v === ',' || v === ';' || (v === ':' && p !== ','))) return false;
  if (prev.type === 'op') {
    if (p === ',') return true;
    if (p === ':') return bracket !== '[';
    if (p === '.') return v === 'import';
    if (p === '=') return bracket !== '(';
    if (p === '@' && k === 1) return false;
    if (isUnary(tokens, k - 1)) return false;
    if (hugsPower(tokens, k - 1)) return false;
  }
  if (t.type === 'op') {
    if (v === '.') return prev.type === 'name' && !isWord(prev);
    if (v === '=') return bracket !== '(';
    if (v === '(' || v === '[') return !(isWord(prev) || prev.type === 'string' || (prev.type === 'op' && CLOSERS.has(p)));
    if (hugsPower(tokens, k)) return false;
  }
  return true;
}

function joinTokens(tokens, context) {
  const brackets = context ? [context] : [];
  let out = '';
  tokens.forEach((t, k) => {
    if (k && spaceBetween(tokens, k, brackets[brackets.length - 1])) out += t.type === 'comment' ? '  ' : ' ';
    out += t.value;
    if (t.type === 'op' && OPENERS.has(t.value)) brackets.push(t.value);
    else if (t.type === 'op' && CLOSERS.has(t.value)) brackets.pop();
  });
  return out;
}

// A comment must end its line; inside brackets a line break is always legal.
function joinWithComments(tokens, indent, context) {
  const lines = [];
  let start = 0;
  tokens.forEach((t, k) => {
    if (t.type === 'comment' && k < tokens.length - 1) {
      lines.push(indent + joinTokens(tokens.slice(start, k + 1), context));
      start = k + 1;
    }
  });
  lines.push(indent + joinTokens(tokens.slice(start), context));
  return lines;
}

function bracketPairs(tokens) {
  const pairs = [], stack = [];
  tokens.forEach((t, k) => {
    if (t.type !== 'op') return;
    if (OPENERS.has(t.value)) stack.push(k);
    else if (CLOSERS.has(t.value) && stack.length) {
      const open = stack.pop();
      if (!stack.length) pairs.push([open, k]);
    }
  });
  return { pairs, depth: stack.length };
}

function topLevelCommas(tokens, open, close) {
  let depth = 0, count = 0;
  for (let k = open + 1; k < close; k++) {
    const v = tokens[k].type === 'op' ? tokens[k].value : '';
    if (OPENERS.has(v)) depth++;
    else if (CLOSERS.has(v)) depth--;
    else if (v === ',' && depth === 0) count++;
  }
  return count;
}

// Comments inside, or a "magic" trailing comma, keep a bracket exploded.
function mustExplode(tokens, open, close) {
  if (tokens.slice(open + 1, close).some(t => t.type === 'comment')) return true;
  return isOp(tokens[close - 1], ',') && (tokens[open].value !== '(' || topLevelCommas(tokens, open, close) > 1);
}

function splitItems(body) {
  const items = [];
  let item = [], depth = 0;
  for (const t of body) {
    if (t.type === 'comment' && !item.length && items.length) { items[items.length - 1].push(t); continue; }
    item.push(t);
    if (t.type !== 'op') continue;
    if (OPENERS.has(t.value)) depth++;
    else if (CLOSERS.has(t.value)) depth--;
    else if (t.value === ',' && depth === 0) { items.push(item); item = []; }
  }
  if (item.length) items.push(item);
  return items;
}

function allowsTrailingComma(tokens, open, items) {
  const opener = tokens[open].value, before = tokens[open - 1];
  const call = Boolean(before) && (isWord(before) || before.type === 'string' || (before.type === 'op' && CLOSERS.has(before.value)));
  const body = items.flat();
  if (body.some(t => t.value === 'for' || t.value === 'lambda')) return false;
  if (opener === '[') return !call;
  if (opener === '(') return call || items.length > 1;
  return true;
}

function addTrailingComma(item) {
  let k = item.length - 1;
  while (k > 0 && item[k].type === 'comment') k--;
  if (!isOp(item[k], ',')) item.splice(k + 1, 0, { type: 'op', value: ',', space: false, newlines: 0 });
}

function render(tokens, level, width, context) {
  const indent = '    '.repeat(level);
  let trailing = '';
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && last.type === 'comment' && bracketPairs(tokens.slice(0, -1)).depth === 0) {
    trailing = '  ' + last.value;
    tokens = tokens.slice(0, -1);
  }
  const finish = lines => { lines[lines.length - 1] += trailing; return lines; };
  const { pairs } = bracketPairs(tokens);
  const forced = pairs.find(([open, close]) => mustExplode(tokens, open, close));
  if (!forced && (!pairs.length || (indent + joinTokens(tokens, context)).length <= width)) {
    return finish(joinWithComments(tokens, indent, context));
  }
  // Like Black's right-hand split: prefer the last bracket whose head fits.
  const candidates = pairs.filter(([open, close]) => close > open + 1);
  const pair = forced || [...candidates].reverse().find(([open]) =>
    (indent + joinTokens(tokens.slice(0, open + 1), context)).length <= width) || candidates[candidates.length - 1];
  if (!pair) return finish(joinWithComments(tokens, indent, context));

  const [open, close] = pair;
  const opener = tokens[open].value;
  const body = tokens.slice(open + 1, close);
  let head = indent + joinTokens(tokens.slice(0, open + 1), context);
  while (body.length && body[0].type === 'comment') head += '  ' + body.shift().value;
  const inner = '    '.repeat(level + 1);
  const explode = mustExplode(tokens, open, close);
  let bodyLines = [];
  if (body.length && !explode && (inner + joinTokens(body, opener)).length <= width) {
    bodyLines = [inner + joinTokens(body, opener)];
  } else if (body.length) {
    const items = splitItems(body);
    if (items.length > 1 || explode) {
      if (allowsTrailingComma(tokens, open, items)) addTrailingComma(items[items.length - 1]);
      bodyLines = items.flatMap(item => render(item, level + 1, width, opener));
    } else bodyLines = render(body, level + 1, width, opener);
  }
  return finish([head, ...bodyLines, ...render(tokens.slice(close), level, width, context)]);
}

// ---------------------------------------------------------------------------
// Blocks and files

// Printed values rather than code: `grad_fn=<AddmmBackward0>` reprs and
// PyTorch module trees such as `(tok_emb): Embedding(50257, 768)`.
function looksLikeOutput(tokens) {
  return tokens.some((t, k) => (isOp(t, '<') && tokens[k + 1]?.type === 'name' && !tokens[k + 1].space
      && isOp(tokens[k + 2], '>') && !tokens[k + 2].space)
    || (isOp(t, '(') && (k === 0 || (isOp(tokens[k - 1]) && /[()]/.test(tokens[k - 1].value)))
      && tokens[k + 1]?.type === 'name' && isOp(tokens[k + 2], ')') && isOp(tokens[k + 3], ':')));
}

// Ignore what formatting may legitimately add or drop: `;` and trailing commas.
function sameTokens(a, b) {
  const beforeCloser = (tokens, k) => {
    while (tokens[k]?.type === 'comment') k++;
    return isOp(tokens[k]) && CLOSERS.has(tokens[k].value);
  };
  const significant = tokens => tokens.filter((t, k) => !isOp(t, ';') && !(isOp(t, ',') && beforeCloser(tokens, k + 1)))
    .map(t => `${t.type}\0${t.value}`);
  const x = significant(a), y = significant(b);
  return x.length === y.length && x.every((v, k) => v === y[k]);
}

function formatPython(code, width = 88) {
  const flattened = !code.trim().includes('\n');
  const tokens = tokenize(code, flattened);
  if (!tokens.length) return { code };
  if (looksLikeOutput(tokens)) return { code, skipped: 'looks like program output' };
  const statements = splitStatements(tokens, flattened);
  (flattened ? guessLevels : sourceLevels)(statements);
  placeComments(statements);
  assignBlankLines(statements, flattened);
  const lines = [];
  for (const s of statements) {
    for (let b = 0; b < s.blank; b++) lines.push('');
    lines.push(...render(s.tokens, s.level, width, null));
  }
  const formatted = lines.join('\n');
  if (!sameTokens(tokens, tokenize(formatted, false))) return { code, skipped: 'formatting would change tokens' };
  return { code: formatted };
}

function formatMarkdown(source, width = 88) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [], skipped = [];
  let blocks = 0, changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!opening) { out.push(lines[i]); continue; }
    const [, pad, marker, info] = opening;
    let end = i + 1;
    for (; end < lines.length; end++) {
      const closing = lines[end].match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) break;
    }
    // Leave other languages and unterminated fences exactly as they are.
    if (end >= lines.length || !/^(?:py|python|python3)$/i.test(info.trim())) {
      out.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }
    blocks++;
    const original = lines.slice(i + 1, end).join('\n');
    const result = formatPython(original, width);
    if (result.skipped) skipped.push({ line: i + 1, reason: result.skipped });
    if (result.code !== original) changed++;
    let fence = marker;
    if (marker[0] === '`') {
      const longest = Math.max(0, ...Array.from(result.code.matchAll(/`+/g), m => m[0].length));
      if (longest >= fence.length) fence = '`'.repeat(longest + 1);
    }
    out.push(pad + fence + info, result.code, pad + fence);
    i = end;
  }
  return { text: out.join(eol), blocks, changed, skipped };
}

module.exports = { formatPython, formatMarkdown };
