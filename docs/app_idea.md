# Loony Library — Web App Design

A general-purpose reading platform: converting static markdown books into a full web app, **any book, any language, any community — React frontend, Node.js backend, PostgreSQL database.** The library holds many books side by side, each with its own outline, content, glossary, and search index.

## Source material

Each book is its own markdown source tree (page-per-file, or curated chapter folders), typically with:
- Front matter: foreword, preface, acknowledgement, list of figures/tables, abbreviations, symbols/suprasegmentals
- Nested section numbering, sometimes several levels deep (e.g. `1.5.4.1.1.1`)
- Embedded figures (`images/*.png`) with captions
- Inline tables

See [migration.md](./migration.md) for how a book's markdown source is turned into rows in the schema below, config-driven per book so adding a new one doesn't require touching the tool itself.

## Core idea

Stop treating the book as flat files and turn it into a **structured, queryable document**: a hierarchical outline (book → chapter → section → subsection, arbitrary depth) made of ordered **content blocks** (paragraph, heading, list, image, table). A one-time migration script parses the existing `.md` files + folder numbering into this structure and loads it into Postgres. After that, the markdown files stop being the source of truth — the database is.

## Architecture

```
React SPA  →  Node.js/Express API  →  PostgreSQL
(reader)      (REST, JSON)             (content + full-text search)
                    │
                    └── static file storage for /images (disk or S3)
```

- **Frontend (React)**: a book-reader UI — collapsible TOC tree, content pane, search, figure lightbox. Think Docusaurus/GitBook-style reading experience rather than a generic CRUD app.
- **Backend (Node.js/Express + an ORM like Prisma)**: serves the TOC, section content, images, and search results; optionally an authenticated admin API for editing.
- **Database (Postgres)**: stores the hierarchical outline, content blocks, figures, glossary/abbreviations, and a `tsvector` index for search.
- **Migration script (one-off Node script)**: reads the current `.md` files, parses headings/lists/tables/images, and inserts rows. This is the bridge from "static book" to "web app."

## Database schema

**books**
`id, slug, title, author, publisher, isbn, edition, price, published_year`
— one row per book in the library; the whole schema is designed around holding many books, not just one.

**chapters**
`id, book_id → books, number, slug, title, sort_order`
— maps to a book's top-level folders/sections.

**sections** (self-referencing tree, handles arbitrary depth: 3, 3.1, 3.3.1.2.1, ...)
`id, chapter_id → chapters, parent_id → sections (nullable), numbering ("3.3.1.2.1"), title, depth, sort_order, source_file (e.g. "0048_The_Nominals.md")`
— `source_file` is kept only for traceability back to the original page numbering, not for runtime use.

**content_blocks** (ordered content within a section — this is what actually renders)
`id, section_id → sections, block_type (paragraph | heading | list | image | table | blockquote), sort_order, content (jsonb or text), tsv (tsvector, generated)`
— one row per paragraph/list/image/table. Keeping content block-level (not one big markdown blob per section) is what makes fine-grained search and later editing possible.

**figures**
`id, content_block_id → content_blocks, image_path, caption, alt_text`
— e.g. `images/_page_0_Figure_4.png` + "Figure 3.1: Basic Classification of Nominals".

**tables** (optional, if structured table data is wanted rather than an HTML/markdown blob)
`id, content_block_id → content_blocks, headers (jsonb), rows (jsonb)`

**glossary_terms** — from the Abbreviations file
`id, term, expansion, category`

**symbols** — from the Symbols/Suprasegmentals file
`id, symbol, description`

**search** — no separate table needed; add a generated `tsvector` column on `content_blocks` (`title`, `content`) with a GIN index, and query it with Postgres full-text search (`plainto_tsquery`) with `ts_rank` for relevance. Good enough at this scale (~227 pages); no need for Elasticsearch.

Optional, only if the app should grow beyond a static reader:
- **users / roles** — login-gated editing or bookmarking.
- **revisions** — content_block version history, if scholarly edits need an audit trail.
- **annotations / bookmarks** — user_id + content_block_id, for reader-side notes.

## API surface (Node/Express)

- `GET /api/books` — every book in the library
- `GET /api/books/:slug/toc` — full chapter/section tree for the sidebar
- `GET /api/sections/:id` — a section's ordered content blocks (paragraphs, images, tables)
- `GET /api/books/:slug/search?q=...` — full-text search across content_blocks, ranked, with section context for deep-linking
- `GET /api/books/:slug/glossary`, `GET /api/books/:slug/symbols`
- `GET /images/:file` — static figure serving
- (optional) `POST/PUT /api/sections/:id/blocks` — admin-only editing endpoints, if this becomes a living/editable document rather than a fixed publication

## Frontend structure (React)

- Sidebar: collapsible TOC tree driven by `chapters`/`sections` nesting
- Main pane: renders `content_blocks` in order, dispatching by `block_type` (paragraph → `<p>`, image → figure component with caption, table → table component, list → `<ul>/<ol>`)
- Search bar: hits `/api/search`, shows ranked snippets, links straight to the matching section
- Figure lightbox for images
- Responsive layout for mobile reading

## Why this shape

The book's actual complexity is the arbitrarily deep numbering (some subsections go 6 levels deep) and mixed content types (prose, figures, tables) inside each section — a flat "one row per markdown file" table wouldn't let you deep-link to `3.3.1.2.1` or search inside a specific paragraph. The self-referencing `sections` table plus block-level `content_blocks` solves both.

## Next steps

- [x] ER diagram — see [er_diagram.md](./er_diagram.md)
- [x] Migration script to parse existing markdown into this schema — see [migration.md](./migration.md) and [migration/](../migration/)
- [x] Express API scaffold — see [backend/](../backend/)
- [x] React reader scaffold — see [frontend/](../frontend/)
- [ ] Deployment / hosting

See [dev_setup.md](./dev_setup.md) for how to run the full stack.
