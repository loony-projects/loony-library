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

- [book-import/](book-import/) — npm workspace, run once per book (or on reload): [packages/markdown-parser](book-import/packages/markdown-parser/) parses a book's markdown source into an outline, [packages/migration](book-import/packages/migration/) loads it into the Postgres schema
- [backend/](backend/) — Express API serving book content, TOC, search, glossary/symbols out of Postgres
- [frontend/](frontend/) — React reader: library landing page, sidebar table of contents, section pages, search
- [docs/](docs/) — design notes, ER diagram, and migration details

## Quick start

See [docs/dev_setup.md](docs/dev_setup.md) for the full walkthrough. In short:

```sh
# 1. Database (once per book — see docs/migration.md)
createdb loony_library
cd book-import && npm install && cp .env.example .env
(cd ../backend && npm install && cp .env.example .env && npm run migrate)   # creates the schema
# set UPLOAD_BOOK_PATH in .env to the book's Markdown directory, then:
npm run load

# 2. Backend (uses book-import's markdown parser, installed above)
cd ../backend
npm start                # http://localhost:4000

# 3. Frontend
cd ../frontend && npm install && cp .env.example .env
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173` — it lists every loaded book; picking one opens its reader with a sidebar table of contents, full-text search, and a glossary/abbreviations page.

## Docker

Everything in containers - Postgres, the API and the built frontend:

```sh
cp .env.example .env              # set POSTGRES_PASSWORD (and the loony-auth client, for sign-in)
docker compose up -d --build      # frontend http://localhost:8080, API http://localhost:4000
docker compose down               # stop; data stays in the db-data / backend-data volumes
```

The backend applies `backend/migrations` every time it starts, so a fresh
database gets the whole schema on first start. Load a book from its Markdown
directory on this machine (a missing directory is an error, never created):

```sh
BOOK_DIR=/home/me/.output/Kotlin/Kotlin/markdown \
  docker compose run --rm import --category programming-languages --publish
docker compose restart backend    # after reloading a book that was already there
```

`VITE_API_URL` is compiled into the frontend image - rebuild after changing it.
Files: [docker-compose.yml](docker-compose.yml), [docker/](docker/), [.env.example](.env.example).

For running without Docker, `scripts/start.sh` / `scripts/stop.sh` start and stop
the dev servers - see [docs/dev_setup.md](docs/dev_setup.md#starting-and-stopping).

## Adding a book

The platform is book-agnostic: a book is just a directory of Markdown (e.g. pdf-to-md output). Point the loader at it — title, slug and structure are derived from the directory. No code changes needed to add a new one — see [docs/migration.md](docs/migration.md).

## Docs

- [docs/app_idea.md](docs/app_idea.md) — overall design and database schema
- [docs/er_diagram.md](docs/er_diagram.md) — entity-relationship diagram
- [docs/migration.md](docs/migration.md) — how markdown books are parsed into the schema
- [docs/dev_setup.md](docs/dev_setup.md) — running the full stack locally

## Accounts, discovery, editing, and reading tools

See [Library features and setup](docs/library-features.md) for the database
upgrade, editor account setup, draft workflow, personal reading features,
exports, and validation commands. Existing installations must run
`npm run migrate` from `backend/` before starting the updated API.
