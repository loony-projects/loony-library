# Migration script

Code lives in [book-import/](../book-import/) — an npm workspace of two packages that together turn a book's markdown source into the schema from [app_idea.md](./app_idea.md) / [er_diagram.md](./er_diagram.md):

- **[packages/markdown-parser](../book-import/packages/markdown-parser/)** (`@loony-library/markdown-parser`) — markdown source → outline `{ book, chapters, glossary, symbols, codeBlocks, diagnostics }`. No database dependency. Public API in [src/index.js](../book-import/packages/markdown-parser/src/index.js), typed in [src/index.d.ts](../book-import/packages/markdown-parser/src/index.d.ts); CLI in [src/cli.js](../book-import/packages/markdown-parser/src/cli.js). The backend's section editor uses the same package ([backend/src/parseMarkdown.js](../backend/src/parseMarkdown.js)), so an edited section is stored in exactly the block shapes an import produces.
- **[packages/migration](../book-import/packages/migration/)** (`@loony-library/migration`) — imports the parser, then copies images and loads the outline into Postgres. Owns [schema.sql](../book-import/packages/migration/schema.sql); later schema changes are in [backend/migrations/](../backend/migrations/) (`004` adds the parser's newer block types and `role` columns).

The input is a book's **Markdown directory** — typically pdf-to-md output (`<name>_page_NNNN.md` files, `<name>_metadata.json`, `images/`), e.g. `~/.output/NodeJs/Beginning_Nodejs/markdown`. There is no per-book config: the title comes from `<name>_metadata.json` (the PDF name) or the folder name, the slug from the title (both overridable with `--title` / `--slug`), and the structure strategy from the directory's shape.

## Pipeline

| Stage | Module | Does |
|---|---|---|
| 1. Ingestion | [markdown.js](../book-import/packages/markdown-parser/src/markdown.js) | The only `unified().use(remarkParse).use(remarkGfm)` processor. CommonMark + GFM (tables, footnotes, strikethrough, task lists). Front matter, directives and MDX are **not** enabled — no source uses them. |
| 2. Traversal + 4. Content | [parseFile.js](../book-import/packages/markdown-parser/src/parseFile.js) | Walks each file's mdast in source order into heading items and content blocks, with source positions. Collects code nested in lists/blockquotes/footnotes. |
| 3. Structure | [toc.js](../book-import/packages/markdown-parser/src/toc.js), `buildOutline*.js` | Chapters from the book's own contents page when it has one; otherwise from the directory shape or heading levels (below). |
| 5. References | [extractTermList.js](../book-import/packages/markdown-parser/src/extractTermList.js) | Glossary and symbol entries from the AST, de-duplicated with diagnostics. |
| 6. Code | [finalize.js](../book-import/packages/markdown-parser/src/finalize.js), [languages.js](../book-import/packages/markdown-parser/src/languages.js), [analysis/](../book-import/packages/markdown-parser/src/analysis/) | Ids, ownership, the `codeBlocks` index, language normalization; optional tree-sitter syntax analysis (`analyzeCodeBlocks`, async). |
| 7. Validation | [diagnostics.js](../book-import/packages/markdown-parser/src/diagnostics.js) | Authoring problems become diagnostics; parsing throws only for unreadable input or programmer errors. |
| 8. Output | [index.js](../book-import/packages/markdown-parser/src/index.js) | `parseBookDirectory(dir)` (sync), `parseBookMarkdown(markdown, options)` (no filesystem), `analyzeCodeBlocks(result)`. |

Each file is parsed once; ownership is assigned in one pass; all state (diagnostics, slugs, stacks) is local to a parse call. The only module-level state is the language/analyzer registry and the tree-sitter grammar cache.

## Output invariants

- **Every block has exactly one owner, in source order.** Chapters never hold blocks directly: a chapter's own content before its first subsection is in its first section (role `body`, titled like the chapter). Every top-level markdown node becomes exactly one block, except a figure caption (folded into its image) and whitespace-only HTML. A node with no dedicated type becomes an `unknown` block with its raw markdown — never dropped.
- **Content outside the outline is always reported.** Files a strategy leaves out by design (`source.file_not_in_outline`) are warnings, never silent.
- **Ids are deterministic and unique:** chapter `ch3`, section `ch3.s0` (pre-order within the chapter), block `ch3.s0.b4`, block inside an HTML wrapper `ch3.s0.b4.1`, nested code `ch3.s0.b5.code0`. The same snippet twice gets two ids. Unchanged source → identical ids.
- **`codeBlocks` is an index, not a second copy of the tree.** Each record points at its `blockId`, `ownerId` (section) and `chapterId`; `rawCode` is a copy of that block's code. Nested code (inside a list, blockquote, footnote) exists only in the index plus its container block's markdown.
- **Roles are separate from heading level.** `chapter.role` / `section.role` come only from explicit markup (below), never from what a heading's text says. `level` is the markdown heading level; `depth` is tree depth.
- The mdast node behind each block is available in-process via `astOf(block)` but is not serialized into the outline JSON or the database. Each block keeps its exact source `markdown` (what the frontend renders) and a plain-text `text` (what search indexes).

### Content block types

`content_blocks.block_type` / `content` (all have `text`):

| Type | Content | Notes |
|---|---|---|
| `paragraph` | `markdown` | Kept even when it has no plain text (inline HTML only). |
| `list` | `ordered`, `items[]`, `markdown` | Nested lists stay in `markdown`; `items` text is newline-separated. |
| `blockquote` | `markdown` | |
| `table` | `headers`, `rows`, `markdown` | GFM. |
| `image` | `src`, `alt`, `caption` | Caption convention: an image-only paragraph immediately followed by a paragraph that is *only* emphasis (`*Figure 3.1: ...*`). |
| `code` | `code`, `lang`, `meta`, `language`, `fenced` | `lang`/`meta` exactly as written; `language` is the normalized id. Indented code has `fenced: false`. |
| `html` | `html`, or `openTag`/`closeTag`/`children` | A block-level open tag and its matching close tag are merged around the blocks between them. |
| `subheading` | — | A heading that isn't a nav section (strategy-dependent, below). |
| `thematic_break` | `markdown` | `---` |
| `footnote` | `identifier`, `label`, `markdown` | GFM footnote definition. |
| `definition` | `identifier`, `label`, `url`, `title` | Link reference definition; kept for round-tripping, not rendered. |
| `unknown` | `nodeType`, `markdown` | Anything else, rendered as escaped source. |

## Book structure strategies

Chosen in this order: `NNN_Name/` chapter subfolders → `numbering`; a contents page whose chapters can be placed → `toc`; otherwise → `headings`.

### `toc` — **[toc.js](../book-import/packages/markdown-parser/src/toc.js)**, **[buildOutlineByToc.js](../book-import/packages/markdown-parser/src/buildOutlineByToc.js)**

For PDF-converted books, whose heading levels are unreliable (`# Listing 2-5. objectLiterals1.js`, `## Understanding Node.js` for a chapter). The book's own table of contents decides what the chapters are:

1. **Find the contents page** — the first page with a heading that is exactly `Contents`, `Table of Contents`, `Contents at a Glance`, `Brief Contents` or `Chapters` (case and emphasis ignored).
2. **Read its entries** from that page and the following pages, for as long as each has page-numbered entries (up to 40 pages): table rows, headings, list items (ordered-list numbers restored) and lines ending in a page number (`… 17`, `— 17`, `(xi)`).
3. **Keep only top-level entries:** `Chapter 3: Title` / `Chapter-III:`, `3 Title` / `3. Title` (single number — `3.1 …` is a sub-entry), `Part II: Title`, `Appendix A: Title`, and other **bold**/heading entries (Preface, Index, About the Author) as front/back matter by position. Chapter numbers must increase; a line that breaks the sequence is ignored (`toc.ignored_entry`). "Contents at a Glance" and a detailed "Contents" listing the same chapters count once.
4. **Place each entry in the pages:**
   - *Anchors* — headings exactly matching an entry (`Chapter 3`, or the same title); the longest chain in the same order as the contents is kept, so an entry the PDF prints elsewhere can't derail the rest.
   - Other entries — a title match near *printed page + the nearest anchor's offset* (±2 pages), else the top of that page (`toc.placed_by_page`). The offset is local: it drifts through a PDF (missing blank pages; *Beginning Node.js* goes from +4 to 0).
   - An entry listed out of book order ("About the Author" listed first, printed last) goes to its only exact heading (`toc.out_of_order`); an entry past the last page file means an incomplete conversion (`toc.beyond_source`).
5. **Build elements:** pages before the first entry (cover, the contents itself) are *Front Matter*; each entry runs to the next entry's start. The opening title heading(s) are consumed. Other headings in a chapter become sections — flat, because their levels are unreliable — except dotted numbering (`1.1` → `1.1.2`), which nests.

Falls back to `headings` when there's no contents page or fewer than two chapters can be placed (`toc.insufficient`).

### `headings` — **[buildOutlineByHeadings.js](../book-import/packages/markdown-parser/src/buildOutlineByHeadings.js)**

The fallback. Every `*.md` directly in the directory, in numeric-aware name order (`page_2` before `page_10`), read as one continuous book — a chapter can span many page files. `parseBookMarkdown()` uses the same rules on a string.

1. **Chapter level** = the shallowest heading level used (ignoring parts); `parseBookMarkdown` also accepts a `chapterLevel` option. A heading at that level starts a chapter.
2. **Explicit roles** — a Pandoc-style class at the end of a heading: `# Preface {.preface}`, `### Appendix A: Tools {.appendix}`. A role heading always starts a top-level element, whatever its level. Unknown classes are reported (`heading.unknown_role`) and left in the title. Roles ([roles.js](../book-import/packages/markdown-parser/src/roles.js)):
   - front matter: `front_matter cover half_title title_page copyright dedication epigraph toc foreword preface introduction prologue acknowledgments`
   - main matter: `part chapter interlude`
   - back matter: `conclusion epilogue afterword appendix notes glossary symbols bibliography index about_author also_by back_matter`
   - aliases: `acknowledgements`, `contents`, `about-the-author`, `also-by`, `references` → bibliography, `endnotes` → notes, `abbreviations` → glossary, and hyphenated forms.
3. **Parts** — `{.part}` starts a part; following `chapter`/`interlude` elements get `partId` until the next part or any front/back-matter element. Parts are chapter rows with role `part` (the schema has no separate part level).
4. **Sections** — deeper headings nest by level under the nearest shallower open heading. A skipped level (`#` then `###`) nests one step deeper and is reported (`heading.skipped_level`).
5. Content before the first heading → a `Front Matter` element (role `front_matter`); a book with no headings → one element titled after the book (`structure.no_headings`).
6. Order is source order. Front matter after main matter (or main after back) is reported (`structure.matter_order`), not reordered. A hand-written "Contents" section is ordinary content (`{.toc}` if you want the role); navigation comes from the parsed structure.

Headings inside code blocks, lists and blockquotes never create structure — they aren't top-level heading nodes.

### `numbering` — **[buildOutlineByNumbering.js](../book-import/packages/markdown-parser/src/buildOutlineByNumbering.js)**

For books curated into `NNN_Name/` chapter directories with dotted numbering in their headings (currently: *Modern Bodo Grammar*). Each directory becomes a chapter. Within a chapter, headings are threaded into a section tree keyed by their numbering's dot-count (`3.3.1` → depth 3), *not* by the markdown `#` level — the source is inconsistent about heading levels (a `####` sometimes outranks a `##`).

The source also uses markdown heading syntax for things that aren't real document sections — glossed morpheme labels like `{a-}:`, list lead-ins like `a) Adding personal prenominal prefixes:`, worked-example lines. Those headings have no numbering. Rather than giving each one a tree node (which produced a staircase of ever-deeper, individually-navigable "sections" — one nested inside the previous), every unnumbered heading is flattened into a `subheading` content block on the nearest *numbered* ancestor section: same reading-order position on the page, but not a nav item, not a URL. This cut the book from 479 sections (many of them these fake headings) to 298 real, navigable ones.

Numbering: `6. Title`, `3.3 Title`, and — for dotted numbers only — `10.1.2Title` with the space missing. A single number glued to a word (`3D Graphics`, `64-bit Atomics`) is part of the title, not numbering.

The loose files directly under `pages/` (`0001_CoverPage.md` etc.) don't go through this generic heading logic at all — several have no real heading of their own (`BookMetadata.md` has none; `CoverPage.md`'s only heading is the author's name). They're curated by hand instead: a fixed `FRONT_MATTER_FILES` list in `buildOutlineByNumbering.js` maps six of them to one flat section each, with a role (Cover Page → `cover`, Publication → `copyright`, Book Metadata → `front_matter`, Foreword, Preface, Acknowledgement → `acknowledgments`), no nesting. In those sections a heading that repeats the section title is dropped; any other heading is kept as a `subheading`. Root files not in the list (a blank page-break file, a dedication page) are excluded by choice and reported as `source.file_not_in_outline`.

## Glossary and symbols

Sources: any element or section whose role is `glossary` / `symbols` (a heading marked `{.glossary}` / `{.symbols}`).

- **Entry forms** — explicit markers only: `TERM → expansion` (one per line, anywhere in a term source), and inside glossary/symbols *elements* also `**TERM**: expansion` (or `—`/`–`). A bold word in ordinary prose is never a term.
- Lines come from paragraphs, list items and blockquotes of the AST; **code (fenced, indented, inline), headings, HTML and tables are never scanned**. A line with two arrows is ambiguous and reported (`terms.invalid_entry`).
- Keys: NFKC-normalized, whitespace-collapsed; case-insensitive for glossary terms, case-sensitive for symbols (`N` ≠ `n`).
- Duplicates: the first definition wins. An identical repeat → `glossary.duplicate` (info); a different definition → `glossary.conflict` (warning) and kept on the entry's `conflictingDefinitions`, never overwritten.
- Each entry has `position`, and — when it came from the book tree — `ownerId`, `blockId`, `chapterId`. Output keeps the old field names (`term`/`expansion`, `symbol`/`description`) the loader writes to `glossary_terms` / `symbols`.

## Code blocks

Every code block anywhere in the tree is in `codeBlocks` (see the invariants above), with: `rawCode` (exact, indentation kept), `originalLanguage` (the label as written), `languageLabel` + `languageAttributes` (`rust,editable` → `rust` + `["editable"]`; `{.python}` and `language-go` are understood), `fenceMeta` (`title="a.js"`), `fenced`, `normalizedLanguage`, `position`, `blockIndex`, `previousBlockId`/`nextBlockId`.

**Lead-in / follow-up rule:** `leadInParagraphId` / `followUpParagraphId` are the paragraph immediately before / after a top-level code block in the same container, if that neighbour is a paragraph. That's adjacency only — no claim that the text explains the code. Nested code has none.

Three separate facts per record:

- `recognizedLanguage` — the label maps to a registered language ([languages.js](../book-import/packages/markdown-parser/src/languages.js); extend with `registerLanguage({ id, name, aliases })`).
- `syntaxAnalysisSupported` — an analyzer is registered for it (and could be loaded).
- `analysisStatus` — for this snippet: `unanalysed` (analysis not run, or the analyzer crashed → `code.analyzer_failed`), `unsupported` (no analyzer / unlabelled / unknown label), `analysed`, `parse_error` (syntax errors; `analysis` keeps partial facts, and `analysis.truncated` is true when the error runs to the end of the snippet — an example cut off by a page break).

`parseBookDirectory()` leaves every record `unanalysed`; `analyzeCodeBlocks(result)` (the CLI runs it unless `--no-analyze`) parses each snippet with a real grammar and never executes it.

| Language | Aliases recognized | Syntax analysis |
|---|---|---|
| Rust | `rust` `rs` | tree-sitter-rust |
| C | `c` `h` | tree-sitter-c |
| C++ | `cpp` `c++` `cc` `cxx` `hpp` `hxx` `hh` | tree-sitter-cpp |
| Go | `go` `golang` | tree-sitter-go |
| Java | `java` | tree-sitter-java |
| JavaScript | `javascript` `js` `mjs` `cjs` `jsx` `node` | tree-sitter-javascript |
| TypeScript | `typescript` `ts` `tsx` `mts` `cts` | tree-sitter-typescript (TSX grammar for `tsx`) |
| Python | `python` `py` `python3` `py3` | tree-sitter-python |
| Kotlin, C#, Swift, Ruby, PHP, Shell, SQL, JSON, YAML, TOML, HTML/XML, CSS, Markdown, Diff, plain text | usual aliases | none — label recognition only, status `unsupported` |

Facts (`analysis`): `imports` (`use`, `#include`, `import`, ...), top-level `declarations` (`kind`, `name`, `exported`, snippet `range`, file `line`), `syntaxErrors`, and `package` for Go/Java. `exported` is set only where the language defines it from syntax — Rust `pub`, Go capitalized names, Java `public`, JS/TS `export`, C/C++ `static` (internal linkage) — and is `null` otherwise. Facts are top-level only: that's what a grammar makes unambiguous. This is syntax, not semantics — no name resolution or type checking.

The grammars are WASM builds loaded through `web-tree-sitter` (no native compilation, no network at parse time); npm doesn't run their install scripts. Add an analyzer with `registerAnalyzer({ id, languages, analyze(code, { label }) })`.

## Diagnostics

`{ severity, code, message, file, line, column, elementId? }`. The CLI prints errors and warnings (all with `--all-diagnostics`); every diagnostic is in the outline's `diagnostics`. The loader refuses to load when there are errors, unless `--allow-errors`.

| Code | Severity | Meaning |
|---|---|---|
| `source.empty` | warning | No content at all. |
| `source.missing_file` | warning | A `numbering` front-matter file listed in `FRONT_MATTER_FILES` doesn't exist. |
| `source.bad_metadata` | warning | `<name>_metadata.json` isn't valid JSON; title taken from the folder name. |
| `source.file_not_in_outline` | warning | `numbering`: a root file not in `FRONT_MATTER_FILES`. |
| `structure.no_headings` | warning | Whole book kept as one element. |
| `structure.content_before_first_heading` | info | Kept in a Front Matter element / Untitled section. |
| `structure.matter_order` | warning | Front/main/back matter out of order. |
| `structure.duplicate_title` | info | Sibling titles repeat (distinct ids). |
| `structure.empty_section`, `structure.empty_element` | info | No content. |
| `heading.empty` | warning | Empty heading (title `Untitled`). |
| `heading.skipped_level` | info | Level jump, nested one step deeper. |
| `heading.unknown_role`, `heading.conflicting_roles` | warning | Unusable `{.class}` on a heading. |
| `block.unknown_node` | info | Kept as an `unknown` block. |
| `toc.used` | info | Which contents page(s) gave the chapters, and how many entries were placed by title vs. page number. |
| `toc.placed_by_page`, `toc.out_of_order` | info | How a particular entry was placed. |
| `toc.unplaced_entry` | warning | An entry couldn't be found; its pages stay with the previous element. |
| `toc.beyond_source` | warning | An entry's page is past the last page file — incomplete conversion. |
| `toc.ignored_entry`, `toc.chapter_gap`, `toc.insufficient` | info | Out-of-sequence line ignored; chapter numbers skip; contents unusable (falls back to headings). |
| `code.unclosed_fence` | warning | Fence never closed. |
| `code.unknown_language` | info | Unrecognized label. |
| `code.syntax_error` | info | Snippet has syntax errors (partial facts kept). |
| `code.analyzer_unavailable`, `code.analyzer_failed` | warning | Analyzer couldn't load / crashed; the rest of the book is still analysed. |
| `terms.invalid_entry`, `terms.no_entries` | warning | Ambiguous/empty term line; a term file with no entries. |
| `glossary.duplicate` / `symbols.duplicate` | info | Same term and definition again. |
| `glossary.conflict` / `symbols.conflict` | warning | Same term, different definition. |

## Example

~~~md
Published by Example Press.

# Preface {.preface}

Why this book.

# Part I: Basics {.part}

# 1. Getting Started

Here is how:

```rust,editable
pub fn main() {}
```

### Skipped a level
~~~

→ (`parseBookMarkdown(md)`, then `analyzeCodeBlocks`)

```
ch0 front_matter "Front Matter"     ch0.s0 body  [paragraph]
ch1 preface      "Preface"          ch1.s0 body  [paragraph]
ch2 part         "Part I: Basics"   ch2.s0 body  []
ch3 chapter      "Getting Started"  number "1", partId ch2
      ch3.s0 body "Getting Started"  [paragraph ch3.s0.b0, code ch3.s0.b1]
      ch3.s1 section "Skipped a level" (level 3, depth 2)
codeBlocks: ch3.s0.b1  originalLanguage "rust,editable" → rust, attributes [editable],
            leadInParagraphId ch3.s0.b0, analysed: function main (exported)
diagnostics: structure.content_before_first_heading, heading.skipped_level, structure.empty_section
```

## Usage

```sh
cd book-import
npm install            # installs both workspace packages (and the tree-sitter grammars)
npm test               # parser tests (node --test)
npm run dry-run -- ~/.output/NodeJs/Beginning_Nodejs/markdown   # writes book-output.md: contents, diagnostics, code analysis, and the book re-assembled by chapter

createdb loony_library
psql "$DATABASE_URL" -f packages/migration/schema.sql
(cd ../backend && npm run migrate)             # later schema changes, incl. 004 (block types, roles)
cp .env.example .env   # set DATABASE_URL
npm run load -- <markdown-dir> [--category <slug>] [--title T] [--author A]   # first load
npm run reload -- <markdown-dir>                # re-parse + wipe-and-reload (deletes by title, cascades)
# with no <markdown-dir>, UPLOAD_BOOK_PATH from .env is used
```

After a `reload`, restart the backend — book ids are memoized per-slug for the process lifetime, so it'll keep pointing at the deleted row until it's bounced.

## Verified against the real source

- *Modern Bodo Grammar* (`numbering` strategy): 18 chapters, 298 sections, 1,600 content blocks (177 of them `subheading`), 98 glossary terms, 9 symbols, no crashes. (Source not on this machine when the pipeline was rewritten; covered by fixture tests only since.)
- *Beginning Node.js* (`toc`): all 18 contents entries placed at their title headings — front matter, Introduction, chapters 1–13, Index, and the three "about" pages the PDF prints at the back. 2,317 blocks, about 0.3s.
- `toc` across the other converted books in `~/.output`: every entry placed for *Practical Node.js* (21), *Modern Operating Systems* (14), *Programming Python* (27), *The Art of PostgreSQL* (62, with 6 parts), *Comprehensive Rust* (74), *Rust Atomics and Locks* (10), *Learn TypeScript* (21). Partial: *HTTP: The Definitive Guide* 30/37, *Operating System Concepts* 28/37 (contents lines the converter mangled); *Speech and Language Processing* 4/18 and *Designing Data-Intensive Applications* 4/17 are incomplete conversions (reported `toc.beyond_source`).
- Before per-book configs were removed, the `flat-chapters` strategy was checked on *Rust Atomics and Locks* (no content lost against the previous parser) and *Comprehensive Rust*.

## Known limitations

- **Books without a usable contents page fall back to heading levels**, which pdf-to-md output often gets wrong (subsections, listings or running heads marked `#`). Mark real structure with `{.role}` classes there. A mangled contents page (*Asynchronous Programming in Rust*: chapter numbers on separate lines from split titles) yields only the entries that could be read. Code that the converter didn't fence (much of *Beginning Node.js*) is ordinary paragraphs, not code blocks.

The source is OCR/PDF-extracted markdown and is inconsistent in places:
- *Modern Bodo Grammar*: a few headings run two bold spans together with no space (`**10.1.2****Inclusive Particle**`) — the numbering rule tolerates this, but it's worth spot-checking after a load.
- *Modern Bodo Grammar*'s own Table of Contents page (`pages/000_First/0012_Chapters.md`) lists every chapter/section as `## N. Title pageNum`, which the numbering rule happily parses as real numbered headings — so it produces its own shadow "sections" (numbering `1`, `2`, ... `16`) inside the front-matter-adjacent "First" chapter, alongside (and un-linked to) the real chapters elsewhere. Harmless (different `chapter_id`, so no id collisions) but worth cleaning up if the Contents page itself needs to render as a real page rather than a data artifact.
- *Jouga Boro Raokhanthi*'s image references don't include the `images/` path prefix and use the wrong extension vs. the file Marker actually extracted (`.jpeg` in the markdown, `.png` on disk) — `migrate.js` resolves each image against what's actually in `sourceDir/images` by basename rather than trusting the literal `src`.
- No structured interlinear-gloss model yet (Bodo word / phonemic transcription / English gloss as three aligned rows) — right now those render as a `table`, `list`, or `subheading` block like any other. Worth a dedicated block type if the reader needs to align glosses.
- Code examples split across PDF pages arrive as two separate code blocks (the converter closes the fence on each page). They're kept as-is, reported `truncated`; joining them would need a rule for when two blocks are "the same" example, which the source doesn't mark.
- Reference-style links (`[text][ref]`) are stored with their `definition` blocks, but the frontend renders each paragraph on its own, so such a link shows as text. No current source uses them.
- Code analysis results and diagnostics live in the outline JSON only; the database stores each code block's `lang`/`meta`/`language`/`fenced`, not the analysis.

## Not built yet

See [dev_setup.md](./dev_setup.md) for what's running.
