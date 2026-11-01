-- What book-import found the last time it loaded each book, for editors'
-- "Import health" page: the parse's warnings and errors, code that doesn't
-- parse, images it couldn't find, and (after a reload) what reader data it
-- moved. One row per book, replaced on every load.
begin;

create table import_reports (
    book_id         uuid primary key references books(id) on delete cascade,
    loaded_at       timestamptz not null default now(),
    mode            text not null check (mode in ('load', 'reload', 'reset')),
    source_dir      text,
    -- { chapters, sections, blocks, codeBlocks, glossary, symbols,
    --   bySeverity: { error, warning, info }, byCode: { "<code>": n } }
    stats           jsonb not null,
    -- every warning and error, then code syntax errors (capped): the
    -- parser's { severity, code, message, file, line, column }
    diagnostics     jsonb not null default '[]',
    -- [{ src, file, line }]
    missing_images  jsonb not null default '[]',
    -- a reload's restore report (annotations / revisions / reading moved)
    reader_data     jsonb
);

commit;
