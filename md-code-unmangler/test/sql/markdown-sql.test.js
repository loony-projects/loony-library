'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatSqlMarkdown, looksLikeSql } = require('../../sql/markdown-sql.cjs');

const run = markdown => formatSqlMarkdown(markdown).text;

test('fences a paragraph of bold-keyword SQL', () => {
  assert.equal(run('Intro.\n\n**select** name **from** track **where** albumid = 193 **order by** trackid;\n\nMore prose.'),
    'Intro.\n\n```sql\n  select name\n    from track\n   where albumid = 193\norder by trackid;\n```\n\nMore prose.');
});

test('undoes Markdown escapes and italic comments', () => {
  assert.equal(run("*-- name: top -- Top albums* **select** count(\\*) **from** pg\\_class;"),
    '```sql\n-- name: top -- Top albums\nselect count(*)\n  from pg_class;\n```');
  assert.equal(run('**create function** f() **returns** int **language** sql **as** \\$\\$ **select** 1 \\$\\$;'),
    '```sql\ncreate function f()\nreturns int\nlanguage sql\nas $$\n  select 1\n$$;\n```');
});

test('drops a line number between the italic pieces of one comment', () => {
  assert.equal(run('**select** x **from** */\\* \\* Generate the calendar* 13 *\\*/* t;'),
    '```sql\nselect x\n  from\n       /*\n        * Generate the calendar\n        */\n       t;\n```');
});

test('gives a comment continued from the previous page its /*', () => {
  assert.equal(run('*\\* even for the first week. \\*/* generate\\_series(1, 3) **as** t(x) **left join** f **using**(x);'),
    '```sql\n/*\n * even for the first week.\n */\ngenerate_series(1, 3) as t(x) left join f using(x);\n```');
});

test('recognizes a listing continued from the previous page', () => {
  assert.equal(run('7 **group by** album 8 **order by** album;'), '```sql\ngroup by album\norder by album;\n```');
});

test('leaves prose, Python and psql sessions alone', () => {
  const prose = 'Create table statements are the first thing we write in a new project, as we see here.';
  assert.equal(run(prose), prose);
  const python = '**class** Model(object): **def** fetch(cls): **if** cls.tablename **and** kwargs: **return** cls';
  assert.equal(run(python), python);
  const session = '**create table** seq(**id** serial); **CREATE TABLE** 3 **select** setval(1); 5 setval ════ 2147483647 8 (1 **row**) 9 yesql# **insert into** seq **values** (**default**); ERROR: out of range';
  const result = formatSqlMarkdown(session);
  assert.equal(result.text, session);
  assert.equal(result.sessions, 1);
});

test('splits output that follows the last query off after the fence', () => {
  assert.equal(run('**select** x **from** t; x ---+--- 1 2'), '```sql\nselect x\n  from t;\n```\n\nx ---+--- 1 2');
});

test('leaves existing fences untouched and keeps CRLF line endings', () => {
  const fenced = '```sql\nselect 1\n  from t\n```';
  assert.equal(run(fenced), fenced);
  assert.equal(run('Intro.\r\n\r\n**select** 1;\r\n'), 'Intro.\r\n\r\n```sql\r\nselect 1;\r\n```\r\n');
});

test('requires unbolded SQL to be lowercase or uppercase and end with ;', () => {
  assert.equal(looksLikeSql('select x from t;'), true);
  assert.equal(looksLikeSql('SELECT x FROM t;'), true);
  assert.equal(looksLikeSql('Select the rows you need from the table'), false);
});
