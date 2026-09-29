# Running the full stack locally

Three pieces: [book-import/](../book-import/) (one-off, already run — see [migration.md](./migration.md)), [backend/](../backend/), [frontend/](../frontend/).

## 1. Database

Already loaded per [migration.md](./migration.md): schema applied, content loaded into a local Postgres database (`loony_library`). Re-run `cd book-import && npm run load` (book set by `UPLOAD_BOOK_PATH` in `book-import/.env`) only if the source markdown changes and you want to reload.

## 2. Backend

The backend parses edited sections with book-import's markdown parser
(`@loony-library/markdown-parser`, linked from `../book-import`), so install
that workspace first:

```sh
(cd book-import && npm install)
cd backend
npm install
cp .env.example .env   # set DATABASE_URL, plus CLIENT_ID / TENANT_ID / SECRET_KEY from loony-auth
npm run migrate          # includes 004: parser block types + chapter/section roles
npm start                # http://localhost:4000
```

Sanity check: `curl http://localhost:4000/api/health` → `{"ok":true}`.

Sign-in goes through loony-auth, so its `auth-api` has to be running (default `http://localhost:8450`) with this app registered as an OAuth client whose redirect URI is `http://localhost:4000/api/auth/callback`. See [backend/README.md](../backend/README.md#sign-in-loony-auth).

## 3. Frontend

```sh
cd frontend
npm install
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:4000
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173` — it lists every loaded book; picking one redirects to its first section, with a sidebar table of contents (from `/api/books/:slug/toc`), full-text search, and an Abbreviations page.

## Architecture recap

```
React (5173) --fetch--> Express (4000) --pg--> Postgres (loony_library)
                              └-- static /images --> repo-root images/
```

CORS on the backend is locked to `CORS_ORIGIN` (defaults to the Vite dev origin) — update it if the frontend is served from somewhere else.

## What's implemented

- Backend: `/api/books`, `/api/books/:slug`, `/api/books/:slug/toc`, `/api/sections/:id`, `/api/books/:slug/search`, `/api/books/:slug/glossary`, `/api/books/:slug/symbols`, static `/images`.
- Frontend: a library landing page listing every book, sidebar table-of-contents reader, section page (breadcrumbs, paragraph/list/image/table/blockquote rendering, sub-section links), debounced search with snippet highlighting, Abbreviations page.

## Not built yet

- Deployment (Docker, hosting, env for production Postgres)
- Automated tests
