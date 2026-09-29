begin;

-- Block types the book-import markdown parser now keeps instead of dropping
-- (see book-import/packages/markdown-parser/src/parseFile.js):
--   thematic_break  a "---" scene/section break
--   footnote        a GFM footnote definition ("[^1]: ...")
--   definition      a link reference definition ("[label]: url")
--   unknown         any other markdown node, kept with its raw markdown
alter table content_blocks drop constraint if exists content_blocks_block_type_check;
alter table content_blocks add constraint content_blocks_block_type_check check (block_type in
    ('paragraph', 'list', 'image', 'table', 'blockquote', 'subheading', 'code', 'html',
     'thematic_break', 'footnote', 'definition', 'unknown'));

-- Structural role of a chapter or section (chapter, part, appendix,
-- preface, glossary, ... / body, section) - see markdown-parser/src/roles.js.
-- Null for rows loaded before the parser recorded roles.
alter table chapters add column if not exists role text;
alter table sections add column if not exists role text;

commit;
