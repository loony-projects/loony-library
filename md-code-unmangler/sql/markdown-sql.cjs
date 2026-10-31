'use strict';

/**
 * SQL step of the cleaner (run via `node cleaner/index.cjs --lang sql`). Finds
 * SQL that PDF extraction squashed into prose paragraphs, as in The Art of
 * PostgreSQL: keywords in bold (`**select**`), comments in italics (`*-- note*`),
 * Markdown escapes (`\_`, `\*`, `\$`) and the listing's line numbers mixed into
 * the code. It removes that markup, formats the code (format-sql.cjs) and fences
 * it as ```sql. A psql session, where queries and their output are mixed, is
 * left as it is; output that only follows the last query is split off after it.
 * Existing fences are left untouched.
 */
const { formatSql, COMMENT_END } = require('./format-sql.cjs');

// A statement's opening words. Prose can start the same way ("Create table
// statements..."), so an unbolded paragraph must also be lowercase or uppercase
// SQL ending in `;` (see looksLikeSql).
const SQL_START = new RegExp('^(?:'
  + 'select\\s|with\\s+(?:recursive\\s+)?[\\w"]+(?:\\s*\\([^)]*\\))?\\s+as\\s*(?:not\\s+)?(?:materialized\\s*)?(?:\\d+\\s+)?\\('
  + '|insert\\s+into\\s|update\\s+[\\w."]+\\s+set\\s|delete\\s+from\\s'
  + '|create\\s+(?:or\\s+replace\\s+|temp\\w*\\s+|unique\\s+|unlogged\\s+|materialized\\s+)*(?:table|view|index|function'
  + '|procedure|schema|extension|type|domain|trigger|sequence|aggregate|operator|database|role|policy|cast)\\b'
  + '|alter\\s+(?:table|system|database|role|sequence|type|index|function|view|domain)\\s'
  + '|drop\\s+(?:table|view|index|function|schema|extension|type|database|role|trigger|sequence|domain)\\s'
  + '|begin\\s*;|start\\s+transaction\\b|commit\\s*;|rollback\\s*;|truncate\\s|explain\\s|table\\s+[\\w."]+\\s*;'
  + '|set\\s+[\\w.]+\\s*(?:to|=)\\s|values\\s*\\(|copy\\s+[\\w."]+\\s+(?:from|to)\\s|grant\\s|revoke\\s|do\\s+\\$'
  + '|\\\\(?:set|copy|i|ir|timing|pset|x|c|connect)\\s|analyze\\b|vacuum\\b|comment\\s+on\\s'
  + '|refresh\\s+materialized\\s|prepare\\s+\\w+|listen\\s|notify\\s'
  + ')', 'i');

// Output printed by psql: table borders, row counts, prompts before a command
// (`yesql# select`, `f1db=> \\d`), errors, timings and command tags such as
// `CREATE TABLE` right after a statement.
const PSQL_OUTPUT = new RegExp('═{3,}|─{3,}|-{3,}\\+|\\((?:\\*\\*)?\\d+ (?:\\*\\*)?rows?(?:\\*\\*)?\\)'
  + '|\\bERROR:|\\bTime: [\\d.]+ ms'
  + '|(?:^|\\s)[\\w~-]*=?[#>] +(?:\\\\[a-z]|(?:\\*\\*)?(?:select|insert|create|update|delete|listen|notify|begin|commit|explain|alter|drop|table|with)\\b)'
  + '|;\\s*(?:\\*\\*)?(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|COPY)\\b[A-Z ]*(?:\\*\\*)?\\s+(?:\\d|\\*\\*[a-z]|$)');

// Removes the Markdown markup. Bold is dropped (`**select**` -> `select`), an
// italic `--` comment gets an end marker for the formatter, a line number left
// between two italic pieces of one comment is dropped, and escapes are undone.
// `\**copy**` is the psql command `\copy` with `copy` in bold.
function stripMarkup(text) {
  text = text.replace(/\\index\{[^}]*\}\s*/g, '');
  let out = '';
  let italic = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text.startsWith('**', i + 1) && /[A-Za-z]/.test(text[i + 3] || '')) {
      out += '\\';
    } else if (ch === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] || '')) {
      out += text[++i];
    } else if (text.startsWith('**', i)) {
      i++;
    } else if (ch === '*') {
      if (italic === null) italic = out.length;
      else {
        const comment = out.slice(italic).trim();
        italic = null;
        const gap = text.slice(i + 1).match(/^\s+\d+\s+(?=\*(?!\*))/);
        if (comment.startsWith('--')) out += COMMENT_END;
        else if (gap) i += gap[0].length - 1;
      }
    } else out += ch;
  }
  // A paragraph that starts inside a block comment from the previous page
  // (`*\* so that ... \*/*`) gets its `/*` back.
  const close = out.indexOf('*/'), open = out.indexOf('/*');
  if (/^\s*\*(?!\*)/.test(text) && close !== -1 && (open === -1 || open > close)) out = `/* ${out.trimStart()}`;
  return out;
}

const stripLineNumbers = text => text.replace(/^(?:\d+\s+)+/, '');

// Words this kind of extraction bolds in SQL. Python and Lisp listings in the
// same book bold their own keywords (`**def**`, `**defun**`), and share some
// (`and`, `for`, `in`), so a fragment also needs a word only SQL bolds.
const SQL_WORDS = new Set(('select from where join left right full inner outer cross natural group order by having '
  + 'using limit offset insert into values update delete set create or replace table view index function alter drop if '
  + 'exists references primary foreign key not null unique default constraint check returning distinct coalesce case '
  + 'when then else end as on over partition window with recursive lateral union all except intersect asc desc returns '
  + 'language declare begin loop commit rollback and in is between like ilike cast interval type extract filter within '
  + 'rows range preceding following current row nulls first last fetch only true false array trigger for each execute '
  + 'procedure perform return next raise notice found new old schema extension sequence materialized copy header csv '
  + 'delimiter id data hour day week month year category').split(' '));
const SQL_STRONG = new Set(('select from where join group order having using limit offset insert values update delete '
  + 'create alter references returning lateral coalesce partition window union intersect').split(' '));

// A paragraph that continues a listing from the previous page starts in the
// middle of a statement, so it is recognized by its bold words instead: mostly
// SQL keywords, at least one only SQL uses, and no sentence outside strings.
function looksLikeFragment(markdown, code) {
  const spans = [...markdown.matchAll(/\*\*([^*\n]+?)\*\*/g)].map(m => m[1].trim().toLowerCase());
  const words = spans.flatMap(span => span.split(/\s+/));
  if (!words.some(word => SQL_STRONG.has(word))) return false;
  if (words.filter(word => !SQL_WORDS.has(word)).length > words.length * 0.25) return false;
  const outsideStrings = code.replace(/'(?:[^']|'')*'/g, "''");
  if (/[A-Z][a-z]+(?: [a-z]+){4}/.test(outsideStrings)) return false;
  return spans.length >= 3 || /;\s*$/.test(code);
}

function looksLikeSql(markdown) {
  const stripped = stripMarkup(markdown);
  const code = stripLineNumbers(stripped.replace(new RegExp(COMMENT_END, 'g'), ' ')).trim();
  // Skip leading comments when checking how the statement starts; an italic
  // `--` comment ends at its marker.
  const statement = stripLineNumbers(stripped.replace(/^(?:\s+|\d+\s|--[^\u0001]*\u0001|\/\*[\s\S]*?\*\/)+/, ''));
  if (SQL_START.test(statement)) {
    const bolded = /^(?:\d+\s+)*(?:\*-[^*]*\*\s*)?\\?\*\*/.test(markdown.trim());
    if (bolded) return true;
    const firstWord = (statement.match(/^\\?[A-Za-z]+/) || [''])[0].replace('\\', '');
    const sameCase = firstWord === firstWord.toLowerCase() || firstWord === firstWord.toUpperCase();
    return sameCase && /;\s*$/.test(code);
  }
  return looksLikeFragment(markdown, code);
}

function fence(code) {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), m => m[0].length));
  const marker = '`'.repeat(Math.max(3, longest + 1));
  return [marker + 'sql', code, marker];
}

function formatSqlMarkdown(source, width = 80) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const stats = { fenced: 0, removed: 0, sessions: 0, skipped: [] };
  let paragraph = [], start = 0;

  function flush() {
    if (!paragraph.length) return;
    const line = start + 1;
    const markdown = paragraph.join(' ');
    let code = markdown, after = '';
    const output = markdown.search(PSQL_OUTPUT);
    if (output !== -1) {
      // Output that only follows the last query is split off after the fence.
      const semicolon = markdown.lastIndexOf(';', output);
      const moreQueries = /\*\*(?:select|insert|update|delete|create|alter|drop|with|begin|commit)\b/i;
      if (semicolon === -1 || PSQL_OUTPUT.test(markdown.slice(0, semicolon))
          || moreQueries.test(markdown.slice(semicolon + 1))) code = null;
      else {
        code = markdown.slice(0, semicolon + 1);
        after = markdown.slice(semicolon + 1).trim();
      }
    }
    if (code === null || !looksLikeSql(code)) {
      if (code === null && looksLikeSql(markdown.slice(0, output))) {
        stats.sessions++;
        stats.skipped.push({ line, reason: 'psql session with output, left as is' });
      }
      out.push(...paragraph);
    } else {
      const result = formatSql(stripMarkup(code), width);
      stats.fenced++;
      stats.removed += result.removed;
      if (result.skipped) stats.skipped.push({ line, reason: result.skipped });
      out.push(...fence(result.code));
      if (after) out.push('', after);
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

module.exports = { formatSqlMarkdown, looksLikeSql, stripMarkup };
