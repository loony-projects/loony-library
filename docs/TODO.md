# TODO

The roadmap from "works" to "a library people choose to read in".

Priority: **P1** = do next (fixes a real problem or unblocks other work),
**P2** = high value, **P3** = nice to have. Features that already exist
(see [library-features.md](library-features.md)) are listed only where they
need extending.

---

## 1. Book import pipeline

### Tooling
- [x] **P1** Move section splitting into the repo: `npm run organize` reads
  the book's contents page, plans sections, backs up `markdown/`, splits
  chapter folders into section folders, and verifies every page rejoins
  byte-for-byte. (The scripts were throwaway and were lost once.)
- [ ] **P1** `book.json` manifest per book: title, subtitle, author(s), slug,
  category, language, edition, year, ISBN, source folder
  (`markdown-cleaned/`). `npm run load` reads it; no more `--title/--author`.
- [ ] **P1** `npm run import -- <folder>`: survey every book under a folder,
  dry-run each, print a summary table (chapters, sections, code blocks,
  warnings, missing images), load the clean ones, list the rest.
- [x] **P1** Fix `--reset`: it deletes by **title**, and the two Build-LLM
  editions share one, so resetting one deletes both. Delete by slug.
- [ ] **P1** Reload a book in place (keep its id) so readers' progress,
  bookmarks, highlights and reviews survive a re-import. Match sections by
  source file + title.
- [ ] **P2** `npm run survey -- <folder>`: read-only report of layout type
  (page folders / one file per section / flat pages), contents page found or
  not, fenced vs unfenced code, image counts.
- [ ] **P2** Watch mode for a book being organized: re-run dry-run on every
  change and show the outline diff.
- [ ] **P2** Outline diff between two imports of the same book (chapters or
  sections added, removed, renamed, moved).
- [ ] **P3** Import from EPUB directly (it already has structure: spine + nav).
- [ ] **P3** Import from a Git repo of Markdown (mdBook / Docusaurus /
  GitBook layouts), e.g. the Rust Book, Comprehensive Rust source.

### Structure detection
- [ ] **P1** Part pages inside a chapter folder (Async Rust, ML in Action)
  should become the part, not a subheading in the chapter's opening.
- [ ] **P2** Use the contents page as a cross-check in folder mode: warn
  when a listed chapter or section has no folder, or a folder isn't listed.
- [ ] **P2** Use the contents page's printed section numbers ("1.1") when the
  page headings don't carry them (Rust Atomics).
- [ ] **P2** Glossary in back pages under another name ("Last Pages" in
  Learning TypeScript) recognized from its `### term` + definition shape and
  loaded into the glossary table.
- [ ] **P2** Index pages: drop them or turn them into a real index linking
  to sections (they're page-number lists that mean nothing on the web).
- [ ] **P3** Detect and drop running headers/footers and page numbers left by
  the PDF converter.

### Content quality
- [ ] **P1** Run the code unmangler during import for books whose code is in
  plain paragraphs (Build-LLM-1); currently a separate manual step.
- [ ] **P1** Missing images reported with file and line (about 10 across
  current books), and found by name anywhere under the book folder.
- [ ] **P2** Unmangler for more languages (Rust, TypeScript, Go) using the
  tree-sitter analyzers already in the parser.
- [ ] **P2** Join paragraphs split across page breaks (the `<!-- page N -->`
  seams in the middle of a sentence).
- [ ] **P2** Fix bold/italic noise around headings (`## **Title**`) at import.
- [ ] **P2** Footnotes: link `<sup>1</sup>` markers to their notes.
- [ ] **P2** Callouts: turn "Note", "Tip", "Warning" sidebars into styled
  admonition blocks.
- [ ] **P3** Tables broken across pages joined back together.
- [ ] **P3** Math (`$…$`) rendered with KaTeX.
- [ ] **P3** Image alt text from figure captions ("Figure 3.2 …").

### Docs
- [ ] **P1** Update [migration.md](migration.md) and
  [prompts/organize-book-markdown.md](prompts/organize-book-markdown.md) with
  every supported layout (NN_ page folders, Chapter_NN_ one-file-per-section,
  Front_Matter/End_Matter/LastPages, role folders, parts from the contents
  page, `00_` introductions).

---

## 2. Reading experience

### Code
- [ ] **P1** Syntax highlighting (Shiki) matching each colour preset.
- [ ] **P1** Copy button and language label on every code block.
- [ ] **P2** Wrap / horizontal scroll toggle; line numbers on long listings.
- [ ] **P2** "Listing 3.2" captions linked to the code they caption.
- [ ] **P2** Run Python snippets in the browser (Pyodide) and Rust/TS via
  playground links.
- [ ] **P3** Diff view when a listing changes a previous one.
- [ ] **P3** Download all code of a chapter as files.

### Navigation
- [ ] **P1** Keyboard shortcuts: `j/k` next/previous section, `/` search,
  `t` toggle sidebar, `?` help.
- [ ] **P2** "On this page" mini-outline of a section's subheadings, with
  scroll spy.
- [ ] **P2** Progress bar per section and per chapter; % read on the
  sidebar's chapters.
- [ ] **P2** Breadcrumbs: Book › Part › Chapter › Section.
- [ ] **P2** Deep links to a paragraph or code block (copy link on hover).
- [ ] **P2** Remember scroll position inside a section, not just the section.
- [ ] **P3** Sidebar filter: type to find a chapter or section by name.
- [ ] **P3** Reading time estimate per section and chapter.

### Layout and comfort
- [ ] **P2** Focus mode: hide sidebar and chrome, centered text.
- [ ] **P2** Adjustable content width.
- [ ] **P2** Image lightbox (zoom diagrams).
- [ ] **P2** Sepia and high-contrast themes alongside the existing presets.
- [ ] **P3** Two-column layout on wide screens (text + code side by side).
- [ ] **P3** Text-to-speech for prose (Web Speech API), skipping code.

### Mobile and offline
- [ ] **P2** Mobile layout pass: drawer sidebar, larger touch targets, code
  blocks that scroll without breaking the page.
- [ ] **P2** PWA: installable, offline reading of downloaded books (service
  worker + IndexedDB).
- [ ] **P3** Swipe between sections.

---

## 3. Search

- [ ] **P1** Replace `ilike '%…%'` over `content::text` (about 65,000
  blocks) with ranked full-text search: `websearch_to_tsquery` + `ts_rank`.
- [ ] **P1** Highlighted snippets with `ts_headline`.
- [ ] **P2** `pg_trgm` indexes for section titles and code identifiers
  (`asyncio.gather`, `Arc::clone`, `useEffect`).
- [ ] **P2** Filters: this book / chapter / category, prose only / code
  only, language of code.
- [ ] **P2** Search-as-you-type with keyboard navigation of results.
- [ ] **P2** Jump to the matched block in the section, highlighted.
- [ ] **P3** Language-aware stemming per book (`english`, `simple` for Bodo).
- [ ] **P3** Semantic search with embeddings (pgvector), shared with the AI
  features below.
- [ ] **P3** "Did you mean" and synonyms (JS → JavaScript, k8s → Kubernetes).

---

## 4. AI features (Claude API)

- [ ] **P2** **Ask the book**: retrieve relevant sections (FTS + pgvector),
  answer with linked citations to the sections used.
- [ ] **P2** **Ask the library**: the same across all books ("which books
  explain Rust lifetimes?").
- [ ] **P2** **Explain this code block** in the reader, aware of the
  surrounding section.
- [ ] **P2** **Summarize this chapter / section**, cached per section.
- [ ] **P2** **Quizzes** per chapter (multiple choice + short answer with
  feedback), tied to reading progress.
- [ ] **P3** **Flashcards** with spaced repetition from highlights and key
  terms.
- [ ] **P3** **Explain like I'm new**: rewrite a hard paragraph simply.
- [ ] **P3** **Translate a section** (e.g. into Bodo or Assamese) on demand.
- [ ] **P3** Import assistant: AI proposes the chapter/section split for a
  messy book; a human approves it before anything moves.
- [ ] **P2** Guardrails: cache answers, per-user rate limits and budgets,
  signed-in only, log prompts/answers for review.

---

## 5. Library and discovery

- [ ] **P2** Book covers: extract the first page image at import, editable
  afterwards.
- [ ] **P2** Book landing page: description, table of contents, stats
  (chapters, pages, code listings), "start reading" / "continue".
- [ ] **P2** Collections / learning paths ("Rust from zero": Comprehensive
  Rust → Async Rust → Rust Atomics).
- [ ] **P2** Tags beyond categories (rust, concurrency, llm, typescript).
- [ ] **P2** Related books ("readers of this also read", same tags).
- [ ] **P3** Editions: link Build-LLM MEAP and 2025 as editions of one book.
- [ ] **P3** "New this week" and "most read" shelves.
- [ ] **P3** Cross-book glossary: one term, every book that defines it.

---

## 6. Personal reading (extend what exists)

- [ ] **P2** Reading stats: streaks, time read, sections finished per week.
- [ ] **P2** Export highlights and notes (Markdown, Obsidian, Readwise).
- [ ] **P2** Notes on code blocks, not only text selections.
- [ ] **P3** Goals ("finish Fluent Python by March") with progress.
- [ ] **P3** Share a highlight as a link or image card.

---

## 7. Community

- [ ] **P3** Public comments / discussion per section, moderated.
- [ ] **P3** Errata reports from readers to editors.
- [ ] **P3** Study groups: shared reading progress for a group.
- [ ] **P3** Public profiles with shelves and reviews (opt-in).

---

## 8. Editors and admin

- [ ] **P1** Import-health page per book: diagnostics, missing images, code
  syntax errors, sections with no content.
- [ ] **P2** Upload a book from the browser (zip of `markdown/`), run the
  dry-run, show the outline, then publish.
- [ ] **P2** Bulk actions: publish/unpublish/delete several books.
- [ ] **P2** Split or merge sections from the outline editor.
- [ ] **P2** Audit log of editor actions.
- [ ] **P3** Roles beyond editor: per-book editors, reviewers.
- [ ] **P3** Scheduled publishing.

---

## 9. Languages and accessibility

- [ ] **P2** UI translation (i18n) — at least English and Bodo, since the
  library already has Bodo and Bodo-glossary categories.
- [ ] **P2** Per-book `lang` attribute and fonts for Bodo/Devanagari text.
- [ ] **P2** Accessibility audit (axe in CI): headings order, contrast of all
  12 colour presets, focus styles, screen-reader labels on icon buttons.
- [ ] **P3** Dyslexia-friendly font option.

---

## 10. Backend and data

- [x] **P1** Clear the slug → id cache (`backend/src/db.js`) when a book is
  reloaded, so the backend needs no restart after an import.
- [ ] **P2** Pagination on `/api/books` and search.
- [ ] **P2** HTTP caching: ETags / `Cache-Control` on published sections,
  TOC and images.
- [ ] **P2** Serve images resized and as WebP/AVIF; lazy-load in the reader.
- [ ] **P2** Indexes reviewed with `EXPLAIN` on the hot queries (TOC, section,
  search, progress).
- [ ] **P2** Deduplicate images by content hash across books.
- [ ] **P3** OpenAPI spec for the API.
- [ ] **P3** Public read-only API with keys.

---

## 11. Security

- [ ] **P2** Rate limits shared across processes (Postgres or Redis) instead
  of per process.
- [ ] **P2** Security headers (CSP, HSTS, Referrer-Policy) via helmet.
- [ ] **P2** `npm audit` / Dependabot in CI.
- [ ] **P2** Sanitize any HTML that ends up in content blocks.
- [ ] **P3** Two-factor auth for editors.

---

## 12. Testing and CI

- [ ] **P1** GitHub Actions: parser tests, backend tests (with a Postgres
  service), frontend lint + build on every push and PR.
- [ ] **P1** Playwright smoke test: open a book, expand a chapter, read a
  section, search, sign in.
- [ ] **P2** Golden-output tests for the parser: the outline of each real
  book layout checked in as a fixture (small excerpts), so parser changes
  show their effect.
- [ ] **P2** Frontend component tests (Vitest + Testing Library) for TocTree,
  SearchBox, ReadingTools.
- [ ] **P2** md-code-unmangler tests in CI.
- [ ] **P3** Visual regression tests for the colour presets.

---

## 13. Operations and deployment

- [ ] **P2** Production deploy guide: Docker Compose on a VPS behind Caddy
  (HTTPS), environment checklist.
- [ ] **P2** Backups: nightly `pg_dump` + `backend/data/images`, restore
  tested.
- [ ] **P2** Structured logging (pino) with request ids; error tracking
  (Sentry).
- [ ] **P2** Health and readiness endpoints for Docker.
- [ ] **P3** Metrics: request latency, slow queries, search volume.
- [ ] **P3** Object storage (S3-compatible) for images instead of local disk.

---

## 14. Codebase

- [ ] **P2** TypeScript (or JSDoc types + `checkJs`) for backend and parser.
- [ ] **P2** One shared Markdown → blocks parser for import and the editor
  (the backend has its own `parseMarkdown.js`).
- [ ] **P2** Split `buildOutlineByFolders.js` (layouts, matter, parts,
  chapters) into smaller modules now that it handles many layouts.
- [ ] **P3** Monorepo tooling (npm workspaces at the root) so one
  `npm install` and `npm test` cover everything.
