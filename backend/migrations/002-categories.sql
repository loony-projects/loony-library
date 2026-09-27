begin;

create table categories (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    name        text not null,
    parent_id   uuid references categories(id) on delete cascade,
    created_at  timestamptz not null default now()
);
create index categories_parent_idx on categories(parent_id);

alter table books add column category_id uuid references categories(id) on delete set null;

insert into categories (slug, name) values
    ('computer-science', 'Computer Science'),
    ('bodo', 'Bodo');

insert into categories (slug, name, parent_id)
    select 'programming-languages', 'Programming Languages', id from categories where slug = 'computer-science';
insert into categories (slug, name, parent_id)
    select 'bodo-glossary', 'Bodo Glossary', id from categories where slug = 'bodo';

update books set category_id = (select id from categories where slug = 'programming-languages')
    where slug in ('comprehensive-rust', 'rust-atomics-and-locks', 'asynchronous-programming-in-rust');

update books set category_id = (select id from categories where slug = 'bodo-glossary')
    where slug = 'administrative-terminology' or slug like 'glossary-of-%';

alter table books drop column genres;

commit;
