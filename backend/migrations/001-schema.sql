-- Loony Library database schema, created from scratch.
--
-- Applied by `npm run migrate` (backend/scripts/migrate.js), which the
-- backend's Docker image also runs on every start. Later schema changes go
-- in new migrations (002-..., 003-...), never edits to this file once a
-- database has applied it.
--
-- Replaces the old book-import schema.sql + 001-library/002-categories/
-- 003-loony-auth/004-parser-blocks-and-roles chain; a database that applied
-- that chain already has exactly this schema (see migrate.js).

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- catalog

create table categories (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    name        text not null,
    parent_id   uuid references categories(id) on delete cascade,
    created_at  timestamptz not null default now()
);
create index categories_parent_idx on categories(parent_id);

create table books (
    id              uuid primary key default gen_random_uuid(),
    slug            text not null unique,  -- "moby-dick", used in URLs and API routes
    title           text not null,
    author          text,
    publisher       text,
    isbn            text,
    edition         text,
    price           text,
    published_year  int,
    cover_image     text,                  -- filename under backend's data/covers/, served at /covers/:file
    language        text not null default 'und',
    series          text,
    volume          numeric check (volume > 0),
    status          text not null default 'draft' check (status in ('draft', 'published')),
    category_id     uuid references categories(id) on delete set null,
    created_at      timestamptz not null default now()
);

create table authors (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    bio         text not null default '',
    photo_url   text,
    created_at  timestamptz not null default now()
);

create table book_authors (
    book_id     uuid references books(id) on delete cascade,
    author_id   uuid references authors(id) on delete cascade,
    primary key (book_id, author_id)
);

-- ---------------------------------------------------------------- content

create table chapters (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    number      text,              -- "1".."16", null for front matter
    slug        text not null,     -- "The_Nominals"
    title       text not null,
    sort_order  int not null,
    role        text,              -- chapter, part, appendix, front_matter, ... (markdown-parser/src/roles.js)
    created_at  timestamptz not null default now(),
    unique (book_id, sort_order)
);

create table sections (
    id              uuid primary key default gen_random_uuid(),
    chapter_id      uuid not null references chapters(id) on delete cascade,
    parent_id       uuid references sections(id) on delete cascade,
    numbering       text,          -- "3.3.1.2.1", null for unnumbered (Foreword, Preface, ...)
    title           text not null,
    depth           int not null,
    sort_order      int not null,
    source_file     text,          -- e.g. "0048_The_Nominals.md" -- traceability only
    role            text,          -- body, section, ...
    status          text not null default 'draft' check (status in ('draft', 'published')),
    draft_markdown  text,
    created_at      timestamptz not null default now()
);
create index sections_chapter_idx on sections(chapter_id);
create index sections_parent_idx on sections(parent_id);

create table content_blocks (
    id          uuid primary key default gen_random_uuid(),
    section_id  uuid not null references sections(id) on delete cascade,
    block_type  text not null check (block_type in
                    ('paragraph', 'list', 'image', 'table', 'blockquote', 'subheading', 'code', 'html',
                     'thematic_break', 'footnote', 'definition', 'unknown')),
    sort_order  int not null,
    content     jsonb not null,    -- shape depends on block_type, see book-import/packages/markdown-parser/src/parseFile.js
    tsv         tsvector generated always as (
                    to_tsvector('english', coalesce(content->>'text', ''))
                ) stored,
    created_at  timestamptz not null default now()
);
create index content_blocks_section_idx on content_blocks(section_id);
create index content_blocks_tsv_idx on content_blocks using gin(tsv);

create table figures (
    id                uuid primary key default gen_random_uuid(),
    content_block_id  uuid not null references content_blocks(id) on delete cascade,
    image_path        text not null,   -- "images/_page_0_Figure_4.png"
    caption           text,
    alt_text          text,
    created_at        timestamptz not null default now()
);

create table tables (
    id                uuid primary key default gen_random_uuid(),
    content_block_id  uuid not null references content_blocks(id) on delete cascade,
    headers           jsonb not null,
    rows              jsonb not null,
    created_at        timestamptz not null default now()
);

create table glossary_terms (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    term        text not null,
    expansion   text not null,
    category    text,
    created_at  timestamptz not null default now()
);

create table symbols (
    id          uuid primary key default gen_random_uuid(),
    book_id     uuid not null references books(id) on delete cascade,
    symbol      text not null,
    description text not null,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- people

-- Sign-in is through loony-auth: a user is identified by the loony-auth
-- subject (`sub` claim), not a local password.
create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null,
    name          text not null,
    role          text not null default 'reader' check (role in ('reader', 'editor')),
    auth_subject  text unique,
    created_at    timestamptz not null default now()
);

create table sessions (
    token_hash  text primary key,
    user_id     uuid not null references users(id) on delete cascade,
    expires_at  timestamptz not null
);

create table reading (
    user_id     uuid references users(id) on delete cascade,
    book_id     uuid references books(id) on delete cascade,
    section_id  uuid references sections(id) on delete set null,
    updated_at  timestamptz not null default now(),
    primary key (user_id, book_id)
);

create table shelves (
    user_id   uuid references users(id) on delete cascade,
    book_id   uuid references books(id) on delete cascade,
    favorite  boolean not null default false,
    wishlist  boolean not null default false,
    rating    int check (rating between 1 and 5),
    review    text not null default '',
    primary key (user_id, book_id)
);

create table annotations (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id) on delete cascade,
    section_id  uuid not null references sections(id) on delete cascade,
    kind        text not null check (kind in ('bookmark', 'highlight', 'note')),
    quote       text not null default '',
    note        text not null default '',
    created_at  timestamptz not null default now()
);
create index annotations_owner_idx on annotations(user_id, section_id);

create table revisions (
    id          uuid primary key default gen_random_uuid(),
    section_id  uuid not null references sections(id) on delete cascade,
    user_id     uuid references users(id) on delete set null,
    title       text not null,
    blocks      jsonb not null,
    markdown    text,
    created_at  timestamptz not null default now()
);
create index revisions_section_idx on revisions(section_id, created_at desc);

-- ---------------------------------------------------------------- seed data

insert into categories (slug, name) values
    ('computer-science', 'Computer Science'),
    ('bodo', 'Bodo');
insert into categories (slug, name, parent_id)
    select 'programming-languages', 'Programming Languages', id from categories where slug = 'computer-science';
insert into categories (slug, name, parent_id)
    select 'bodo-glossary', 'Bodo Glossary', id from categories where slug = 'bodo';

commit;
