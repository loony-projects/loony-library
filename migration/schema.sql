-- Loony Library content schema
-- Mirrors docs/app_idea.md. Run once against an empty database:
--   psql "$DATABASE_URL" -f schema.sql

create extension if not exists pgcrypto;

create table books (
    id              uuid primary key default gen_random_uuid(),
    slug            text not null unique,  -- "moby-dick", used in URLs and API routes
    title           text not null,
    author          text,
    publisher       text,
    isbn            text,
    edition         text,
    price           text,
    published_year  int
);

create table chapters (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    number      text,              -- "1".."16", null for front matter
    slug        text not null,     -- "The_Nominals"
    title       text not null,
    sort_order  int not null,
    unique (book_id, sort_order)
);

create table sections (
    id          uuid primary key default gen_random_uuid(),
    chapter_id  uuid not null references chapters(id) on delete cascade,
    parent_id   uuid references sections(id) on delete cascade,
    numbering   text,              -- "3.3.1.2.1", null for unnumbered (Foreword, Preface, ...)
    title       text not null,
    depth       int not null,
    sort_order  int not null,
    source_file text               -- e.g. "0048_The_Nominals.md" -- traceability only
);

create index sections_chapter_idx on sections(chapter_id);
create index sections_parent_idx on sections(parent_id);

create table content_blocks (
    id          uuid primary key default gen_random_uuid(),
    section_id  uuid not null references sections(id) on delete cascade,
    block_type  text not null check (block_type in
                    ('paragraph', 'list', 'image', 'table', 'blockquote', 'subheading', 'code')),
    sort_order  int not null,
    content     jsonb not null,    -- shape depends on block_type, see migration/src/parseFile.js
    tsv         tsvector generated always as (
                    to_tsvector('english', coalesce(content->>'text', ''))
                ) stored
);

create index content_blocks_section_idx on content_blocks(section_id);
create index content_blocks_tsv_idx on content_blocks using gin(tsv);

create table figures (
    id                uuid primary key default gen_random_uuid(),
    content_block_id  uuid not null references content_blocks(id) on delete cascade,
    image_path        text not null,   -- "images/_page_0_Figure_4.png"
    caption           text,
    alt_text          text
);

create table tables (
    id                uuid primary key default gen_random_uuid(),
    content_block_id  uuid not null references content_blocks(id) on delete cascade,
    headers           jsonb not null,
    rows              jsonb not null
);

create table glossary_terms (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    term        text not null,
    expansion   text not null,
    category    text
);

create table symbols (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    symbol      text not null,
    description text not null
);
