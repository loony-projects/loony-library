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
# no env file needed: the dev server's API is http://localhost:4000 (see .env.example)
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173` — it lists every loaded book; picking one redirects to its first section, with a sidebar table of contents (from `/api/books/:slug/toc`), full-text search, and an Abbreviations page.

## Starting and stopping

Once both are installed and configured, from the repo root:

```sh
scripts/start.sh            # loony-auth + backend + frontend in the background
scripts/start.sh backend    # or just one: auth | backend | frontend
scripts/stop.sh             # stop them (or: scripts/stop.sh auth | backend | frontend)
```

`start.sh` waits until each app answers (loony-auth's `/ready`, `/api/health`,
then the Vite page) and says where it's running; logs are in `.run/auth.log`,
`.run/backend.log` and `.run/frontend.log`. Ports: loony-auth from
`LOONY_AUTH_URL` in `backend/.env` (8450), backend `PORT` (4000), frontend
`FRONTEND_PORT` (default 5173). Running `start.sh` again while an app is up does
nothing; `stop.sh <app>` also stops an app started by hand on its port.

loony-auth is found at `LOONY_AUTH_DIR` (default `~/projects/loony-auth`).
Before starting it, `start.sh` applies its pending database migrations with
`sqlx migrate run` - an unapplied migration makes its hosted sign-in page fail
with "Something went wrong". Its first start compiles it (up to 5 minutes). If
it isn't found, the library starts anyway, without sign-in. Plain
`scripts/stop.sh` stops loony-auth only if `start.sh` started it, since other
apps may share it.

## Browser smoke test

```sh
cd e2e
npm install && npm run install-browser   # once: Playwright and Chromium
npm test
```

It creates an `e2e` schema in `DATABASE_URL` (from `backend/.env`), runs the
migrations there, loads the fixture book (`e2e/fixtures/e2e-book`) with
book-import, builds the frontend, serves both from the backend on port 4199,
and drives it in Chromium: library -> book -> chapter -> section (code block
with copy button) -> search, and library-wide search. The schema is dropped
afterwards; nothing else in the database is touched. CI runs it too.

## Public site through a Cloudflare tunnel

The library is published at **https://books.lovegood.in** and loony-auth at
**https://auth.lovegood.in**, both through the Cloudflare tunnel in
`~/.cloudflared/config.yml`:

```yaml
  - hostname: auth.lovegood.in
    service: http://127.0.0.1:8450      # loony-auth's auth-api
  - hostname: books.lovegood.in
    service: http://127.0.0.1:4000      # this backend: frontend + API + images
```

One origin serves everything: the backend serves the built frontend
(`frontend/dist`, built with an empty `VITE_API_URL` so API calls are relative)
next to `/api` and `/images`, so the session cookie is first-party. `start.sh`
rebuilds `frontend/dist` whenever the frontend source is newer than the last
build. The backend trusts `X-Forwarded-Proto` from cloudflared on loopback, so
cookies get `Secure` over HTTPS.

`backend/.env` for both local and public use:

```sh
LOONY_AUTH_URL=https://auth.lovegood.in    # loony-auth's issuer (JWT_ISSUER in its .env)
CORS_ORIGIN=http://localhost:5173,http://localhost:4173,https://books.lovegood.in
OAUTH_REDIRECT_URI=http://localhost:4000/api/auth/callback,https://books.lovegood.in/api/auth/callback
```

A sign-in uses the callback on the origin it came in on. Every callback must
also be registered for the app in loony-auth (its `application_redirect_uris`
table - it has no API to add one to an existing app):

```sh
psql "<loony-auth DATABASE_URL>" -c "insert into application_redirect_uris (application_id, redirect_uri)
  values ('<CLIENT_ID>', 'https://books.lovegood.in/api/auth/callback') on conflict do nothing"
```

After editing the tunnel config, restart cloudflared (it reads the config only
at startup), and point DNS at the tunnel once:
`cloudflared tunnel route dns <tunnel-id> books.lovegood.in`.

The Vite dev server (5173) stays local-only: never expose it through the tunnel.

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
