# Loony Library

A general-purpose reading platform for turning static markdown books into a searchable web app — any book, any language, any community. The library holds many books side by side, each with its own outline, content, glossary, and full-text search.

**Stack:** React (Vite) frontend → Node.js/Express API → PostgreSQL.

```
React SPA  →  Node.js/Express API  →  PostgreSQL
(reader)      (REST, JSON)             (content + full-text search)
                    │
                    └── static file storage for /images
```

## Project layout

- [migration/](migration/) — config-driven tool that parses a book's markdown source into the Postgres schema (run once per book, or on reload)
- [backend/](backend/) — Express API serving book content, TOC, search, glossary/symbols out of Postgres
- [frontend/](frontend/) — React reader: library landing page, sidebar table of contents, section pages, search
- [docs/](docs/) — design notes, ER diagram, and migration details

## Quick start

See [docs/dev_setup.md](docs/dev_setup.md) for the full walkthrough. In short:

```sh
# 1. Database (once per book — see docs/migration.md)
createdb loony_library
psql "$DATABASE_URL" -f migration/schema.sql
cd migration && npm install && cp .env.example .env
npm run load -- --book books/<slug>.json

# 2. Backend
cd ../backend && npm install && cp .env.example .env
npm start                # http://localhost:4000

# 3. Frontend
cd ../frontend && npm install && cp .env.example .env
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173` — it lists every loaded book; picking one opens its reader with a sidebar table of contents, full-text search, and a glossary/abbreviations page.

## Adding a book

The platform is book-agnostic: each book is just a small JSON config under [migration/books/](migration/books/) (slug, title/author metadata, source directory, and an outline-building strategy) plus its markdown source tree. No code changes needed to add a new one — see [docs/migration.md](docs/migration.md) for how the config-driven migration works.

## Docs

- [docs/app_idea.md](docs/app_idea.md) — overall design and database schema
- [docs/er_diagram.md](docs/er_diagram.md) — entity-relationship diagram
- [docs/migration.md](docs/migration.md) — how markdown books are parsed into the schema
- [docs/dev_setup.md](docs/dev_setup.md) — running the full stack locally
