# backend

Express API serving Loony Library's book content out of Postgres — any number of books, each addressed by its own slug. See [../docs/dev_setup.md](../docs/dev_setup.md) for the full stack.

```sh
npm install
cp .env.example .env   # DATABASE_URL, PORT, CORS_ORIGIN
npm start                # http://localhost:4000
```

## Endpoints

- `GET /api/health`
- `GET /api/books` — every loaded book's metadata, plus a `chapter_count` (numbered chapters only, excluding front matter)
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
