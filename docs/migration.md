# Migration script

Code lives in [book-import/](../book-import/) — an npm workspace of two packages that together turn a book's markdown source into the schema from [app_idea.md](./app_idea.md) / [er_diagram.md](./er_diagram.md):

- **[packages/markdown-parser](../book-import/packages/markdown-parser/)** (`@loony-library/markdown-parser`) — markdown source → outline `{ book, chapters, glossary, symbols, codeBlocks, diagnostics }`. No database dependency. Public API in [src/index.js](../book-import/packages/markdown-parser/src/index.js), typed in [src/index.d.ts](../book-import/packages/markdown-parser/src/index.d.ts); CLI in [src/cli.js](../book-import/packages/markdown-parser/src/cli.js). The backend's section editor uses the same package ([backend/src/parseMarkdown.js](../backend/src/parseMarkdown.js)), so an edited section is stored in exactly the block shapes an import produces.
- **[packages/migration](../book-import/packages/migration/)** (`@loony-library/migration`) — imports the parser, then copies images and loads the outline into Postgres. The schema it loads into is [backend/migrations/001-schema.sql](../backend/migrations/001-schema.sql), created by the backend's `npm run migrate`.

The input is a book's **Markdown directory** — typically pdf-to-md output (`<name>_page_NNNN.md` files, `<name>_metadata.json`, `images/`), e.g. `~/.output/NodeJs/Beginning_Nodejs/markdown`. The directory is `UPLOAD_BOOK_PATH` in `book-import/.env`. There is no per-book config: the title comes from `<name>_metadata.json` (the PDF name) or the folder name, the slug from the title (both overridable with `--title` / `--slug`). The structure comes only from what the book states, never from the headings in its pages: **organized folders** if the book has them (below), otherwise **the book's own contents page**. A book with neither is reported ("Chapters weren't found") and not imported.

## Pipeline

| Stage | Module | Does |
|---|---|---|
| 1. Ingestion | [markdown.js](../book-import/packages/markdown-parser/src/markdown.js) | The only `unified().use(remarkParse).use(remarkGfm)` processor. CommonMark + GFM (tables, footnotes, strikethrough, task lists). Front matter, directives and MDX are **not** enabled — no source uses them. |
| 2. Traversal + 4. Content | [parseFile.js](../book-import/packages/markdown-parser/src/parseFile.js) | Walks each file's mdast in source order into heading items and content blocks, with source positions. Collects code nested in lists/blockquotes/footnotes. |
| 3. Structure | [toc.js](../book-import/packages/markdown-parser/src/toc.js), [buildOutlineByToc.js](../book-import/packages/markdown-parser/src/buildOutlineByToc.js) | Chapters from the book's own contents page (below) — the only source of structure. |
| 5. References | [extractTermList.js](../book-import/packages/markdown-parser/src/extractTermList.js) | Glossary and symbol entries from the AST, de-duplicated with diagnostics. |
| 6. Code | [finalize.js](../book-import/packages/markdown-parser/src/finalize.js), [languages.js](../book-import/packages/markdown-parser/src/languages.js), [analysis/](../book-import/packages/markdown-parser/src/analysis/) | Ids, ownership, the `codeBlocks` index, language normalization; optional tree-sitter syntax analysis (`analyzeCodeBlocks`, async). |
| 7. Validation | [diagnostics.js](../book-import/packages/markdown-parser/src/diagnostics.js) | Authoring problems become diagnostics; parsing throws only for unreadable input or programmer errors. |
| 8. Output | [index.js](../book-import/packages/markdown-parser/src/index.js) | `parseBookDirectory(dir)` (sync), `parseBookPages(pages, metadata)` (same rules, pages already in memory), `analyzeCodeBlocks(result)`. |

Each file is parsed once; ownership is assigned in one pass; all state (diagnostics, slugs, stacks) is local to a parse call. The only module-level state is the language/analyzer registry and the tree-sitter grammar cache.

## Output invariants

- **Every block has exactly one owner, in source order.** Each chapter (and the front matter) is exactly one section (role `body`, titled like the chapter) holding all its blocks; headings inside it are `subheading` blocks in place, never sections. Every top-level markdown node becomes exactly one block, except a figure caption (folded into its image) and whitespace-only HTML. A node with no dedicated type becomes an `unknown` block with its raw markdown — never dropped.
- **Nothing is dropped between chapters.** Pages before the first contents entry (cover, copyright, the contents page itself) form the Front Matter element; each chapter runs up to the next one.
- **Ids are deterministic and unique:** chapter `ch3`, section `ch3.s0` (pre-order within the chapter), block `ch3.s0.b4`, block inside an HTML wrapper `ch3.s0.b4.1`, nested code `ch3.s0.b5.code0`. The same snippet twice gets two ids. Unchanged source → identical ids.
- **`codeBlocks` is an index, not a second copy of the tree.** Each record points at its `blockId`, `ownerId` (section) and `chapterId`; `rawCode` is a copy of that block's code. Nested code (inside a list, blockquote, footnote) exists only in the index plus its container block's markdown.
- **Roles come from the contents page** (below), never from headings in the pages.
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

## Chapters and sections from organized folders

**[buildOutlineByFolders.js](../book-import/packages/markdown-parser/src/buildOutlineByFolders.js)** — used when `markdown/` holds numbered folders, as produced with [prompts/organize-book-markdown.md](./prompts/organize-book-markdown.md):

```
markdown/
  01_FrontPages/                 front matter - one section per file (02_Copyright.md -> "Copyright")
  02_<Chapter>/                  a chapter: its loose pages are the chapter's opening ("body" section)
    01_<Section>/                each numbered subfolder is a section
  03_Part_I_<Title>/             a folder whose first heading is "Part ..." is a part;
  04_Part_I_<Chapter>/             later chapters carrying the same Part_ label belong to it
  NN_Appendix_A_<Title>/         an appendix (or a folder whose first heading is "Appendix A ...")
  NN_BackPages/                  back matter - one section per file (01_Glossary.md is the glossary)
```

- The folders are the structure; no contents page is needed, and headings never create chapters or sections.
- Titles and numbers come from each folder's own title heading — the first heading of its first page, when it names the folder (`## 1.1 What is an LLM?` for `01_What_is_an_LLM`, `## A.1 What is PyTorch`, `## Appendix A. Introduction to PyTorch`). That heading is consumed; every other heading stays in place as a `subheading`. Without a matching heading the folder name is used (`_` → space).
- Chapters are numbered 1, 2, 3… in folder order; appendices get their letter.
- Parts: a `Part_` folder, a folder named like a part the contents page lists, or a part banner at the start of a chapter folder - a first heading "Part 1: …", "Part XV" (titled by the next heading), or a part the contents page lists ("Classification" for "PART 1CLASSIFICATION") - before the chapter's own title. The banner and the text up to the chapter title become the part; the chapters after it belong to it.
- File names inside front/back pages give those sections their role (`Copyright`, `Glossary`, `About_the_Author`).
- Reported, not used: `.md` files loose in `markdown/` (`folders.loose_file`) and folders nested deeper than chapter → section (`folders.nested_ignored`).

### Splitting chapters into sections: `npm run organize`

A book organized into chapter folders of pages, but without section folders
yet, gets them from **[packages/organizer](../book-import/packages/organizer/)**:

```sh
cd book-import
npm run organize                       # the plan for the book in UPLOAD_BOOK_PATH; nothing changes
npm run organize -- --show             # ... listing every section and the page/line it starts at
npm run organize -- --apply            # back up markdown/, split, verify
npm run organize -- --pdf-contents 7-12 --apply   # contents list read from those PDF pages
```

- Sections come from the book's own contents list: the Markdown list
  pdf-to-md writes in a `Chapters/` or `Contents/` folder (top level or one
  down, e.g. `00_FrontPages/Chapters/`; `--contents <path>` names another).
  A chapter's least-indented entries are its sections; deeper entries are
  subsections and stay inside them.
- When the contents page lost its indentation (a flattened table),
  `--pdf-contents <first>-<last>` reads those pages of the book's PDF with
  `pdftotext -layout` instead.
- Each section is located as a heading in its chapter folder, near its
  printed page (the PDF page offset is worked out from the chapter folders).
  Listed sections with no matching heading are reported and left in place.
- A chapter folder the contents list doesn't cover - or every chapter, in a
  book without one - uses its numbered `N.1`, `N.2` … headings (`A.1` in
  appendices).
- `--apply` first writes `markdown-backup-before-sections.tar.gz` next to
  `markdown/` (never overwriting an earlier one). Text is never changed: a
  page moves whole into its section folder, or is cut at the line where a
  section starts, both pieces keeping the page's file name; the chapter
  folder keeps the opening. Every page is then checked to rejoin
  byte-for-byte; a chapter that doesn't is restored exactly as it was.
- Only chapter folders with page files and no section folders are touched,
  so running it again does nothing.

## Book metadata: `book.json`

A `book.json` in the book's folder (next to `markdown/`) holds what the
Markdown doesn't say, so `npm run load` / `npm run reload` need no flags:

```json
{
  "title": "Natural Language Processing with Transformers",
  "slug": "nlp-with-transformer-models",
  "author": "Lewis Tunstall, Leandro von Werra, Thomas Wolf",
  "language": "en",
  "category": "computer-science",
  "publish": true,
  "source": "markdown-cleaned"
}
```

Fields (all optional): `title`, `slug`, `author`, `publisher`, `isbn`,
`edition`, `year`, `language`, `series`, `volume`, `category` (a category
slug), `publish` (load as published, not draft), `source` - the Markdown
folder to read, relative to `book.json` (default `markdown/`) - and
`unmangle` (`"py"`, `"rust"`, `"js"`, `"java"` or `"sql"`): for a book whose
code came out of the PDF as plain paragraphs, `dry-run`, `load`/`reload` and
`import` first regenerate `markdown-cleaned/` from `markdown/` with
[md-code-unmangler](../md-code-unmangler/) (deleting the old copy) and read
that; `markdown/` itself is never changed. It's found whether `UPLOAD_BOOK_PATH` is
the book folder or its `markdown/` folder. Flags (`--title`, `--slug`,
`--author`, `--category`, `--publish`) win over it; without it, title and
slug come from `<name>_metadata.json` or the folder name. An unknown field or
a wrong type stops the command with the problem named.

## Chapters from the book's contents page

Used for flat per-page Markdown (no numbered folders).

**[toc.js](../book-import/packages/markdown-parser/src/toc.js)**, **[buildOutlineByToc.js](../book-import/packages/markdown-parser/src/buildOutlineByToc.js)**

A book's chapters are whatever its own table of contents lists. Headings in the pages are never used to decide what a chapter or section is — in PDF-converted Markdown their levels are unreliable (`# Listing 2-5. objectLiterals1.js`, `## Understanding Node.js` for a chapter).

1. **Find the contents page** — the first page with a heading that is exactly `Contents`, `Table of Contents`, `Contents at a Glance`, `Brief Contents` or `Chapters` (case and emphasis ignored). **None → error `toc.not_found`: "Chapters weren't found"**; `dry-run` writes nothing and `load` loads nothing.
2. **Read its entries** from that page and the following pages, for as long as each has page-numbered entries (up to 40 pages): table rows, headings, list items (ordered-list numbers restored) and lines ending in a page number (`… 17`, `— 17`, `(xi)`).
3. **Keep only top-level entries:** `Chapter 3: Title` / `Chapter-III:`, `3 Title` / `3. Title` (single number — `3.1 …` is a sub-entry), `Part II: Title`, `Appendix A: Title`, and other **bold**/heading entries (Preface, Index, About the Author). Chapter numbers must increase; a line that breaks the sequence is ignored (`toc.ignored_entry`). "Contents at a Glance" and a detailed "Contents" listing the same chapters count once. **No chapter entries, or none locatable → error `toc.insufficient`.**
4. **Locate each listed entry in the pages** — this is the only use of headings, and only to find where an entry the contents page names begins:
   - *Anchors* — headings exactly matching an entry (`Chapter 3`, or the same title); the longest chain in the same order as the contents is kept, so an entry the PDF prints elsewhere can't derail the rest.
   - Other entries — a title match near *printed page + the nearest anchor's offset* (±2 pages), else the top of that page (`toc.placed_by_page`). The offset is local: it drifts through a PDF (missing blank pages).
   - An entry listed out of book order ("About the Author" listed first, printed last) goes to its only exact heading (`toc.out_of_order`); an entry past the last page file means an incomplete conversion (`toc.beyond_source`); one that can't be found at all stays with the previous element (`toc.unplaced_entry`).
5. **Build elements:** pages before the first entry are *Front Matter*; each entry runs to the next entry's start and is **one section**. Its opening title heading(s) are consumed; every other heading stays in place as a `subheading` block.

**Roles:** `chapter`, `part` (later chapters get its `partId`), `appendix` from the entry's label. An unnumbered entry whose whole title names a book part gets that role — `Preface`, `Foreword`, `Introduction`, `Acknowledgments`/`Acknowledgement`, `Glossary`/`Abbreviations`, `Symbols`, `Index`, `Bibliography`/`References`, `About the Author`, … ([roles.js](../book-import/packages/markdown-parser/src/roles.js)); any other is `front_matter` or `back_matter` by position.

## Glossary and symbols

Sources: the element for a contents entry titled `Glossary` / `Abbreviations` (role `glossary`) or `Symbols` (role `symbols`), or a front/back-pages file named that way (`01_Glossary.md`).

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
| `source.empty` | error | The directory has no Markdown files. |
| `toc.not_found` | error | No contents page — chapters weren't found. |
| `toc.insufficient` | error | The contents page has no chapter entries, or none could be located in the pages. |
| `folders.used` | info | Structure taken from organized folders. |
| `folders.loose_file`, `folders.nested_ignored` | warning | A page outside the numbered folders, or a folder nested deeper than chapter → section; not in the outline. |
| `source.bad_metadata` | warning | `<name>_metadata.json` isn't valid JSON; title taken from the folder name. |
| `structure.duplicate_title` | info | Two chapters with the same title (distinct ids). |
| `structure.empty_element` | info | A chapter with no content. |
| `block.unknown_node` | info | Kept as an `unknown` block. |
| `toc.used` | info | Which contents page(s) gave the chapters, and how many entries were placed by title vs. page number. |
| `toc.placed_by_page`, `toc.out_of_order` | info | How a particular entry was placed. |
| `toc.unplaced_entry` | warning | An entry couldn't be found; its pages stay with the previous element. |
| `toc.beyond_source` | warning | An entry's page is past the last page file — incomplete conversion. |
| `toc.ignored_entry`, `toc.chapter_gap` | info | Out-of-sequence contents line ignored; chapter numbers skip. |
| `code.unclosed_fence` | warning | Fence never closed. |
| `code.unknown_language` | info | Unrecognized label. |
| `code.syntax_error` | info | Snippet has syntax errors (partial facts kept). |
| `code.analyzer_unavailable`, `code.analyzer_failed` | warning | Analyzer couldn't load / crashed; the rest of the book is still analysed. |
| `terms.invalid_entry`, `terms.no_entries` | warning | Ambiguous/empty term line; a term file with no entries. |
| `glossary.duplicate` / `symbols.duplicate` | info | Same term and definition again. |
| `glossary.conflict` / `symbols.conflict` | warning | Same term, different definition. |

## Example

Pages (in file order):

~~~md
<!-- book_page_0001.md -->
# Contents

**Preface** v

**1 Getting Started** 1

<!-- book_page_0002.md -->
# Preface

Why this book.

<!-- book_page_0003.md -->
# Getting Started

Here is how:

```rust,editable
pub fn main() {}
```

### Listing 1-1
~~~

→ `parseBookDirectory(dir)`, then `analyzeCodeBlocks`:

```
ch0 front_matter "Front Matter"     ch0.s0 [subheading "Contents", paragraph, paragraph]
ch1 preface      "Preface"          ch1.s0 [paragraph]
ch2 chapter      "Getting Started"  number "1"
      ch2.s0 [paragraph ch2.s0.b0, code ch2.s0.b1, subheading "Listing 1-1"]
codeBlocks: ch2.s0.b1  originalLanguage "rust,editable" → rust, attributes [editable],
            leadInParagraphId ch2.s0.b0, analysed: function main (exported)
```

Without the `# Contents` page: no chapters, and `toc.not_found` — "Chapters weren't found: no page has a contents heading".

## Usage

```sh
cd book-import
npm install            # installs both workspace packages (and the tree-sitter grammars)
npm test               # parser tests (node --test)
npm run dry-run        # the book in UPLOAD_BOOK_PATH (.env); writes book-output.md: contents, diagnostics, code analysis, and the book re-assembled by chapter

createdb loony_library
(cd ../backend && npm run migrate)             # creates the schema (backend/migrations)
cp .env.example .env   # set DATABASE_URL
npm run load -- [--category <slug>] [--title T] [--author A]   # first load
npm run reload                                  # update an already loaded book in place, keeping readers' data
npm run load -- --reset                         # delete it (and readers' data) and load it fresh
# the book is always UPLOAD_BOOK_PATH in .env - change it there to switch books
```

New books and their sections are drafts unless loaded with `--publish` (or
`"publish": true` in `book.json`). `load` refuses a slug that's already
loaded.

`npm run import -- <folder>` does this for every book under a folder (a
book is a directory with a `book.json` or a `markdown/` folder): it parses
each and prints a table - chapters, sections, code blocks, warnings, errors,
missing images, and whether it would be loaded (new), reloaded (already
loaded) or skipped (parse errors). With `--apply` it loads and reloads them,
each in its own transaction; a failure doesn't stop the rest.

Images are matched by base name in `markdown/images/`, then anywhere under
the book's folder; every image that isn't found - and every `![]()` with no
source - is listed with its page file and line.

`reload` keeps the book row - its id, shelves, ratings, reviews, reading
history, co-authors and cover - and replaces its chapters, sections,
glossary and symbols. What pointed at an old section moves to the matching
new one: annotations (bookmarks, highlights, notes), revisions and reading
positions, plus each section's publish status and saved draft. A section
matches by chapter slug + title (+ which occurrence of the title), else by
its position when the chapter has as many sections as before; reader data
of a section that's gone moves to its chapter's start (or the book's) and is
counted in the report. A published book stays published.

## Verified against the real source

Books in `~/.output` with contents-page-only parsing:
- Chapters found: *Speech and Language Processing* (6 — the conversion is incomplete, the rest are reported `toc.beyond_source`), *An Introduction to Bodo Phonology* (5).
- Contents page but no recognizable chapter entries (`toc.insufficient`): *Kotlin*, *Large Language Model* (chapter titles run together on one italic line, no numbers).
- No contents page (`toc.not_found`): *Python Crash Course*, *Maths Class 12*, *Bodo-English Dictionary*, *RAITHAI-BIHUNG*, *Glossary of Geography*, *Bithorai Class 10*.

Earlier, the same contents-page reader placed every entry of *Beginning Node.js* (18), *Practical Node.js* (21), *Modern Operating Systems* (14), *Programming Python* (27), *The Art of PostgreSQL* (62, with 6 parts), *Comprehensive Rust* (74), *Rust Atomics and Locks* (10) and *Learn TypeScript* (21).

## Known limitations

- **A book needs a contents page.** Without one (or with one the reader can't make out) it isn't imported — add or fix the contents page in its Markdown. A mangled contents page (*Asynchronous Programming in Rust*: chapter numbers on separate lines from split titles) yields only the entries that could be read.
- **No sections within a chapter.** Each chapter is one section; its headings are subheadings. Sub-entries in the contents (`3.1 …`) aren't used yet.
- Code that the converter didn't fence (much of *Beginning Node.js*) is ordinary paragraphs, not code blocks.

The source is OCR/PDF-extracted markdown and is inconsistent in places:
- *Jouga Boro Raokhanthi*'s image references don't include the `images/` path prefix and use the wrong extension vs. the file Marker actually extracted (`.jpeg` in the markdown, `.png` on disk) — `migrate.js` resolves each image against what's actually in `sourceDir/images` by basename rather than trusting the literal `src`.
- No structured interlinear-gloss model yet (Bodo word / phonemic transcription / English gloss as three aligned rows) — right now those render as a `table`, `list`, or `subheading` block like any other. Worth a dedicated block type if the reader needs to align glosses.
- Code examples split across PDF pages arrive as two separate code blocks (the converter closes the fence on each page). They're kept as-is, reported `truncated`; joining them would need a rule for when two blocks are "the same" example, which the source doesn't mark.
- Reference-style links (`[text][ref]`) are stored with their `definition` blocks, but the frontend renders each paragraph on its own, so such a link shows as text. No current source uses them.
- Code analysis results and diagnostics live in the outline JSON only; the database stores each code block's `lang`/`meta`/`language`/`fenced`, not the analysis.

## Not built yet

See [dev_setup.md](./dev_setup.md) for what's running.
