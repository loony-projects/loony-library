'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatSql, COMMENT_END } = require('../../sql/format-sql.cjs');

const format = code => formatSql(code).code;

test('puts each clause on its own line with keywords right-aligned', () => {
  assert.equal(format('select genre.name, count(*) as count from genre left join track using(genreid) group by genre.name order by count desc;'), [
    '  select genre.name, count(*) as count',
    '    from genre',
    '         left join track using(genreid)',
    'group by genre.name',
    'order by count desc;',
  ].join('\n'));
});

test('indents a subquery that does not fit and keeps a short one inline', () => {
  assert.equal(format("select title from ( select albumid, title from album join artist using(artistid) where artist.name = 'AC/DC' ) as artist_albums left join track using(albumid);"), [
    'select title',
    '  from (',
    '         select albumid, title',
    '           from album',
    '                join artist using(artistid)',
    "          where artist.name = 'AC/DC'",
    '       ) as artist_albums',
    '       left join track using(albumid);',
  ].join('\n'));
  assert.equal(format("select * from get_all_albums((select artistid from artist where name = 'x'));"),
    "select *\n  from get_all_albums((select artistid from artist where name = 'x'));");
});

test('removes listing line numbers but keeps numbers that are SQL', () => {
  const result = formatSql('with w as 2 ( select a, 4 b from t where x = 1 order by date 10 ) select * from w order by 2 desc 8 limit 3 31 ;');
  assert.equal(result.removed, 5);
  assert.match(result.code, /where x = 1/);
  assert.match(result.code, /order by 2 desc/);
  assert.match(result.code, /limit 3;$/);
  assert.match(result.code, /select a, b/);
  assert.equal(formatSql('select (1, 2) > (1, 3), count(*) = 4 from t limit 10 offset 5;').removed, 0);
  assert.equal(formatSql("\\set n 1 select * from t limit :n;").removed, 0);
});

test('keeps blank lines that consecutive line numbers mark', () => {
  assert.equal(format('1 begin; 2 3 drop table if exists t; 4 create table t(id int); 5 6 commit;'),
    'begin;\n\ndrop table if exists t;\ncreate table t(id int);\n\ncommit;');
});

test('turns a comment with a known end into its own line', () => {
  assert.equal(format(`-- name: top-artists -- Get the top artists${COMMENT_END} select name from artist;`),
    '-- name: top-artists -- Get the top artists\nselect name\n  from artist;');
});

test('lays out a star block comment one line per star', () => {
  assert.equal(format('select x from /* * Generate the calendar * for the month. */ generate_series(1, 3) as t(x);'), [
    'select x',
    '  from',
    '       /*',
    '        * Generate the calendar',
    '        * for the month.',
    '        */',
    '       generate_series(1, 3) as t(x);',
  ].join('\n'));
});

test('formats a PL/pgSQL function body', () => {
  assert.equal(format("create or replace function f ( in name text, out album text, out duration interval ) returns setof record language plpgsql as $$ declare rec record; begin for rec in select albumid from album where album.name = f.name loop return next; end loop; end; $$;"), [
    'create or replace function f (',
    '  in name text,',
    '  out album text,',
    '  out duration interval',
    ')',
    'returns setof record',
    'language plpgsql',
    'as $$',
    '  declare',
    '    rec record;',
    '  begin',
    '    for rec in',
    '      select albumid',
    '        from album',
    '       where album.name = f.name',
    '    loop',
    '      return next;',
    '    end loop;',
    '  end;',
    '$$;',
  ].join('\n'));
});

test('breaks a long case expression at when, then and else', () => {
  assert.equal(format("select case when lag(nbraces, 1) over(order by decade) is null then '' else format('+%3s', nbraces - lag(nbraces, 1) over(order by decade)) end as evolution from t;"), [
    'select case',
    '         when lag(nbraces, 1) over(order by decade) is null',
    "         then ''",
    "         else format('+%3s', nbraces - lag(nbraces, 1) over(order by decade))",
    '       end as evolution',
    '  from t;',
  ].join('\n'));
});

test('formats a listing continued from the previous page', () => {
  assert.equal(format("where artist.artistid = f.artistid group by album order by album; $$;"),
    '   where artist.artistid = f.artistid\ngroup by album\norder by album;\n$$;');
  assert.equal(format("create function f() returns int language sql as $$ select 1"),
    'create function f()\nreturns int\nlanguage sql\nas $$\n  select 1');
  assert.match(format("select 'Lorem ipsum dolor"), /^select 'Lorem ipsum dolor$/);
});

test('keeps a psql meta-command on its own line', () => {
  assert.equal(format("\\copy factbook from 'factbook.csv' with delimiter E'\\t' null '' 13 alter table factbook alter shares type bigint;"),
    "\\copy factbook from 'factbook.csv' with delimiter E'\\t' null ''\nalter table factbook alter shares type bigint;");
});

test('returns the code unchanged when formatting would change its tokens', () => {
  const result = formatSql('1 select mymodel.id, ... 2 from mymodel 3 where id=1;');
  assert.equal(result.skipped, 'formatting would change the code');
});
