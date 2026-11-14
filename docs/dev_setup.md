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
cp .env.example .env   # set DATABASE_URL, plus CLIENT_ID / SECRET_KEY from loony-auth
npm run migrate          # includes 004: parser block types + chapter/section roles
npm start                # http://localhost:4000
```

Sanity check: `curl http://localhost:4000/api/health` → `{"ok":true}`.

Sign-in goes through loony-auth, so its `auth-api` has to be running (default `http://localhost:2001`) with this app registered as an OAuth client whose redirect URI is `http://localhost:4000/api/auth/callback`. See [backend/README.md](../backend/README.md#sign-in-loony-auth).

## 3. Frontend

```sh
cd frontend
npm install
# no env file needed: the dev server's API is http://localhost:4000 (see .env.example)
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173` — it lists every loaded book; picking one redirects to its first section, with a sidebar table of contents (from `/api/books/:slug/toc`), full-text search, and an Abbreviations page.

## Starting and stopping

Once both are installed and configured, everything runs through `./loony`
from the repo root (`./loony help` lists it all):

```sh
./loony start               # loony-auth + backend + frontend in the background
./loony start backend       # or just some: auth | backend | frontend
./loony stop                # stop them (or: ./loony stop frontend ...)
./loony restart backend     # stop, then start
./loony status              # what's running, on which port, and its log
./loony logs backend        # follow a log

./loony install             # npm install everywhere, plus Playwright's Chromium
./loony build-apps          # rebuild the frontend the backend serves
./loony lint                # lint the frontend
./loony test                # unit tests (or: ./loony test backend ...)
./loony e2e                 # browser smoke test (below)

./loony migrate             # apply pending library database migrations
./loony editor you@example.com

./loony book dry-run        # the book in UPLOAD_BOOK_PATH: parse, load, reload, organize
./loony book load --reset
./loony book import <folder> --apply
```

`start` waits until each service answers (loony-auth's `/ready`, `/api/health`,
then the Vite page) and says where it's running; logs are in `.run/auth.log`,
`.run/backend.log` and `.run/frontend.log`. Ports: loony-auth `LOONY_AUTH_PORT`
(default 2001), backend `PORT` in `backend/.env` (4000), frontend
`FRONTEND_PORT` (default 5173). Starting a service that's already up does
nothing; `stop <service>` also stops one started by hand on its port, and
`status` shows it as `external`.

loony-auth is found at `LOONY_AUTH_DIR` (default `~/ai/loony-auth`).
Before starting it, `./loony start` applies its pending database migrations with
`sqlx migrate run` - an unapplied migration makes its hosted sign-in page fail
with "Something went wrong". Its first start compiles it (up to 5 minutes). If
it isn't found, the library starts anyway, without sign-in. A plain
`./loony stop` (or `restart`) stops loony-auth only if `./loony` started it,
since other apps may share it.

## Images in loony-s3

Book images and covers are served at `/images/...` and `/covers/...`. By
default they live in `backend/data/images` and `backend/data/covers`. With
`IMAGE_STORE=s3` in `backend/.env` they live in a
[loony-s3](../../loony-s3) bucket instead: the book loader uploads to it, and
the backend signs each request and streams the image back. loony-s3 has no
public reads, so browsers never reach it directly. The URLs and the database
are the same either way, so you can switch back and forth.

```sh
IMAGE_STORE=s3
S3_ENDPOINT=http://127.0.0.1:7353   # loony-s3 API (LS3_BIND_ADDR)
S3_REGION=us-east-1                 # LS3_REGION on the loony-s3 server
S3_BUCKET=loony-library
S3_CLIENT_ID=...
S3_CLIENT_SECRET=...
```

The book loader (`./loony book ...`) reads these from `backend/.env` too,
unless they're set in its own environment. In the bucket, images are under
`images/<book-slug>/` and covers under `covers/`.

To set it up:

1. **A key.** In loony-s3's admin panel (see `loony-s3/docs/admin.md`),
   under **Access keys**, create a key for the library. Its secret is shown
   once. Put both in `backend/.env` as `S3_CLIENT_ID` and
   `S3_CLIENT_SECRET`, with `IMAGE_STORE` still unset.
2. **The bucket**, created with that key, because a bucket belongs to the
   key that creates it. Any S3 client works, for example
   `AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... aws --endpoint-url http://127.0.0.1:7353 s3 mb s3://loony-library`.
3. **Copy what's on disk:** `./loony images push --dry-run`, then
   `./loony images push`. It skips files already in the bucket with the same
   bytes, so it's safe to run again.
4. **Switch:** set `IMAGE_STORE=s3`, then `./loony restart backend`. Keep
   `backend/data/images` until you've checked a few books.

The browser tests always use the disk store (`e2e/env.mjs`), so they never
need loony-s3 or write to it.

## Browser smoke test

```sh
cd e2e
npm install && npm run install-browser   # once: Playwright and Chromium
npm test
```

Or from the repo root: `./loony e2e` (after `./loony install`).

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
    service: http://127.0.0.1:2001      # loony-auth's auth-api
  - hostname: books.lovegood.in
    service: http://127.0.0.1:4000      # this backend: frontend + API + images
```

One origin serves everything: the backend serves the built frontend
(`frontend/dist`, built with an empty `VITE_API_URL` so API calls are relative)
next to `/api` and `/images`, so the session cookie is first-party. `./loony start`
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
                              └-- /images, /covers --> backend/data/ (or loony-s3, IMAGE_STORE=s3)
```

CORS on the backend is locked to `CORS_ORIGIN` (defaults to the Vite dev origin) — update it if the frontend is served from somewhere else.

## What's implemented

- Backend: `/api/books`, `/api/books/:slug`, `/api/books/:slug/toc`, `/api/sections/:id`, `/api/books/:slug/search`, `/api/books/:slug/glossary`, `/api/books/:slug/symbols`, `/images` and `/covers` (disk or loony-s3).
- Frontend: a library landing page listing every book, sidebar table-of-contents reader, section page (breadcrumbs, paragraph/list/image/table/blockquote rendering, sub-section links), debounced search with snippet highlighting, Abbreviations page.

## Not built yet

- Deployment (Docker, hosting, env for production Postgres)
- Automated tests
