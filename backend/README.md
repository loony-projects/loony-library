# backend

Express API serving Loony Library's book content out of Postgres — any number of books, each addressed by its own slug. See [../docs/dev_setup.md](../docs/dev_setup.md) for the full stack.

```sh
npm install
cp .env.example .env   # DATABASE_URL, PORT, CORS_ORIGIN, loony-auth client settings
npm run migrate          # applies any migrations/*.sql not yet applied
npm start                # http://localhost:4000
```

## Sign-in (loony-auth)

Accounts live in loony-auth, not here. This backend is an OAuth 2.1 / OpenID Connect client of it:

- `GET /api/auth/login` — open it as a full-page navigation. It redirects to loony-auth's hosted sign-in page, with state, PKCE and a nonce kept in a short-lived HttpOnly `oauth_tx` cookie.
- `GET /api/auth/callback` — loony-auth redirects back here. The backend exchanges the code using `CLIENT_ID`/`SECRET_KEY`, checks the ID token's signature against loony-auth's JWKS (issuer, audience = `CLIENT_ID`, expiry, nonce), and checks that the access token's `org_id` equals `TENANT_ID`. It then creates or updates the local user by loony-auth subject, sets the `library_session` cookie and redirects back to the frontend the sign-in started from. On any failure it redirects to that frontend's `/?auth_error=...` instead. The cookie isn't named plain `session` because cookies ignore the port, so it would collide with loony-auth's own `session` cookie on `localhost`.
- `POST /api/auth/logout` and `GET /api/auth/me` work as before. Logging out ends the library session only, not the loony-auth session.

Settings (see `.env.example`): `CORS_ORIGIN` (comma-separated frontend origins; defaults to the Vite dev server, and `.env.example` also lists `vite preview` on 4173), `LOONY_AUTH_URL`, `CLIENT_ID`, `TENANT_ID` (the loony-auth organization id), `SECRET_KEY` and `OAUTH_REDIRECT_URI` (must exactly match the redirect URI registered for the client). Keep the real `SECRET_KEY` in `.env`, which is gitignored. Never put it in `.env.example`.

Roles stay local: everyone who signs in starts as a `reader`. After someone has signed in once, promote them with `npm run editor -- their@email`.

## Endpoints

- `GET /api/health`
- `GET /api/books` — every loaded book's metadata, plus a `chapter_count` (numbered chapters only, excluding front matter)
- `POST /api/books` — create a book, `multipart/form-data` (`title`, plus optional `author`, `publisher`, `isbn`, `edition`, `price`, `published_year`, `cover` file); slug is derived from the title and uniquified automatically
- `GET /api/books/:slug` — one book's metadata
- `GET /api/books/:slug/toc` — nested chapter/section tree
- `POST /api/books/:slug/chapters` — create a chapter (`{ title, number? }`), appended after existing ones, with one empty top-level section titled after it
- `DELETE /api/chapters/:id` — delete a chapter and everything in it (cascades to its sections, content_blocks, figures, tables)
- `GET /api/sections/:id` — a section's breadcrumbs, immediate children, and ordered content blocks
- `POST /api/sections` — create a section (`{ chapter_id, parent_id?, title, markdown? }`); omit `parent_id` for a top-level section, pass it to nest under an existing section
- `PUT /api/sections/:id` — replace a section's content from edited markdown (`{ markdown: "..." }`); re-parses and re-inserts its content_blocks
- `DELETE /api/sections/:id` — delete a section and everything under it (child sections cascade recursively, then their own content_blocks/figures/tables)
- `GET /api/books/:slug/search?q=...` — full-text search (Postgres `tsvector`/`ts_rank`), ranked, with `ts_headline` snippets
- `GET /api/books/:slug/glossary`, `GET /api/books/:slug/symbols`
- `GET /images/:file` — figures referenced by image content blocks
- `GET /covers/:file` — book cover images uploaded via `POST /api/books`
