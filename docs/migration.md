# Migration script

Code lives in [migration/](../migration/) — a standalone Node tool (its own `package.json`) that parses a book's markdown source into the schema from [app_idea.md](./app_idea.md) / [er_diagram.md](./er_diagram.md). It's config-driven: each book gets a small JSON file under [migration/books/](../migration/books/) (slug, title/author/..., `sourceDir`, and which of the two outline-building strategies below to use), so adding a new book doesn't mean editing the tool itself.

## How it works

1. **[migration/src/parseFile.js](../migration/src/parseFile.js)** — parses a single markdown file with `remark` (GFM enabled for tables) into a flat list of items: headings (level, numbering if any, title) and content blocks (paragraph, list, image, table, blockquote). An image paragraph immediately followed by an italic-only paragraph is merged into one `image` block with the italic text as its caption (matches the `![](...)` + `*Figure 3.1: ...*` pattern used throughout the source). Shared by both strategies below, unchanged by either.

2. Two outline-building strategies turn a book's parsed pages into a chapter/section tree, selected per-book by the `strategy` field in its config:

### `numbering` — **[migration/src/buildOutlineByNumbering.js](../migration/src/buildOutlineByNumbering.js)**

For books curated into `NNN_Name/` chapter directories with dotted numbering in their headings (currently: *Modern Bodo Grammar*). Each directory becomes a chapter. Within a chapter, headings are threaded into a section tree keyed by their numbering's dot-count (`3.3.1` → depth 3), *not* by the markdown `#` level — the source is inconsistent about heading levels (a `####` sometimes outranks a `##`).

   The source also uses markdown heading syntax for things that aren't real document sections — glossed morpheme labels like `{a-}:`, list lead-ins like `a) Adding personal prenominal prefixes:`, worked-example lines. Those headings have no numbering. Rather than giving each one a tree node (which produced a staircase of ever-deeper, individually-navigable "sections" — one nested inside the previous), every unnumbered heading is flattened into a `subheading` content block on the nearest *numbered* ancestor section: same reading-order position on the page, but not a nav item, not a URL. This cut the book from 479 sections (many of them these fake headings) to 298 real, navigable ones.

   The loose files directly under `pages/` (`0001_CoverPage.md` etc.) don't go through this generic heading logic at all — several have no real heading of their own (`BookMetadata.md` has none; `CoverPage.md`'s only heading is the author's name). They're curated by hand instead: a fixed `FRONT_MATTER_FILES` list in `buildOutlineByNumbering.js` maps six of them to one flat section each (Cover Page, Publication, Book Metadata, Foreword, Preface, Acknowledgement), no nesting. A blank page-break file and a dedication page are excluded from the outline entirely, by choice, not by parsing failure.

### `flat-chapters` — **[migration/src/buildOutlineFlatChapters.js](../migration/src/buildOutlineFlatChapters.js)**

For books that are a flat dump of per-page markdown (raw `pdf-to-md` output, no curated chapter directories) with no numbering scheme in their headings to derive depth from — currently *Jouga Boro Raokhanthi*. Two problems specific to this shape:

- **Heading level isn't reliable either.** Some subsection headings sit at the exact same `##` level as real chapters — e.g. *Jouga Boro Raokhanthi*'s "बिसुं" (Compound) chapter has six subtypes; one is correctly nested as `### 3. ...` but four others (`## 2. ...`, `## 4. ...`, `## 5. ...`, `## 6. ...`) are marked at chapter level. Distinguishing a real chapter from a mis-leveled subsection by text alone isn't reliable enough to automate with confidence.
- **A chapter's title heading can be missing outright.** *Jouga Boro Raokhanthi* chapter 19 ("जिरायसिन खान्थि") lost its opening page to a skipped OCR page (`skip_pages` in the pdf-to-md run) — there is no heading anywhere in the source that says its name.

So this strategy doesn't try to detect chapter boundaries from content at all: each book config lists its chapters explicitly as `{ number, slug, title, startPage }`, verified once by hand against the source (and, for *Jouga Boro Raokhanthi*, cross-checked against its own printed table of contents — every chapter's real page-file number is its printed TOC page number + 7, which also independently confirms chapter 19 sat on the skipped page). Every chapter becomes **exactly one flat section — no sub-sections** — and every heading found within it, at any level, becomes an in-place `subheading` content block rather than a nav-tree node. `frontMatter` in the config is the same idea as `FRONT_MATTER_FILES` above, keyed by page number instead of filename.

3. **[migration/src/extractTermList.js](../migration/src/extractTermList.js)** — the Abbreviations and Symbols pages are flat `TERM → expansion` lists rather than prose, so they're parsed separately into `glossary_terms` / `symbols` rows.

4. **[migration/src/migrate.js](../migration/src/migrate.js)** — orchestrates the above and either:
   - writes the parsed tree to a JSON file (`--out`, default `outline.json`) for inspection, no database required, or
   - loads it into Postgres (`--load`), using `DATABASE_URL`, inside a single transaction.

## Usage

```sh
cd migration
npm install
npm run dry-run -- --book books/jougabodo-rawokhanthi.json   # writes outline.json, no DB needed

createdb loony_library
psql "$DATABASE_URL" -f schema.sql
cp .env.example .env   # set DATABASE_URL
npm run load -- --book books/jougabodo-rawokhanthi.json      # first load
npm run reload -- --book books/jougabodo-rawokhanthi.json    # re-parse + wipe-and-reload (deletes by title, cascades)
```

After a `reload`, restart the backend — book ids are memoized per-slug for the process lifetime, so it'll keep pointing at the deleted row until it's bounced.

## Verified against the real source

- *Modern Bodo Grammar* (`numbering` strategy): 18 chapters, 298 sections, 1,600 content blocks (177 of them `subheading`), 98 glossary terms, 9 symbols, no crashes.
- *Jouga Boro Raokhanthi* (`flat-chapters` strategy): 22 chapters (plus a front-matter chapter), one flat section each by design, no crashes.

## Known limitations (source data, not the parser)

The source is OCR/PDF-extracted markdown and is inconsistent in places:
- *Modern Bodo Grammar*: a few headings run two bold spans together with no space (`**10.1.2****Inclusive Particle**`) — the numbering regex tolerates this, but it's worth spot-checking after a load.
- *Modern Bodo Grammar*'s own Table of Contents page (`pages/000_First/0012_Chapters.md`) lists every chapter/section as `## N. Title pageNum`, which the numbering regex happily parses as real numbered headings — so it produces its own shadow "sections" (numbering `1`, `2`, ... `16`) inside the front-matter-adjacent "First" chapter, alongside (and un-linked to) the real chapters elsewhere. Harmless (different `chapter_id`, so no id collisions) but worth cleaning up if the Contents page itself needs to render as a real page rather than a data artifact.
- *Jouga Boro Raokhanthi*'s image references don't include the `images/` path prefix and use the wrong extension vs. the file Marker actually extracted (`.jpeg` in the markdown, `.png` on disk) — `migrate.js` resolves each image against what's actually in `sourceDir/images` by basename rather than trusting the literal `src`.
- No structured interlinear-gloss model yet (Bodo word / phonemic transcription / English gloss as three aligned rows) — right now those render as a `table`, `list`, or `subheading` block like any other. Worth a dedicated block type if the reader needs to align glosses.

## Not built yet

See [dev_setup.md](./dev_setup.md) for what's running.
