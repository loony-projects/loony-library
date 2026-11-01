# book-import

Turns a book's markdown source into rows of the Postgres schema defined in
[backend/migrations/001-schema.sql](../backend/migrations/001-schema.sql). An
npm workspace of three packages:

- [packages/organizer](./packages/organizer/) — splits a book's chapter
  folders into section folders from its own contents list (`npm run organize`).
- [packages/markdown-parser](./packages/markdown-parser/) — markdown → outline
  (`{ book, chapters, glossary, symbols, codeBlocks, diagnostics }`), no
  database needed. Also used by the backend's section editor.
- [packages/migration](./packages/migration/) — parses via the package above,
  copies images, and loads the outline into Postgres.

The input is a book's Markdown directory (e.g. pdf-to-md output:
`<name>_page_NNNN.md`, `<name>_metadata.json`, `images/`). Chapters come
from organized folders (`01_FrontPages/`, `02_<Chapter>/01_<Section>/`, …, see
../docs/prompts/organize-book-markdown.md) when the book has them, otherwise
only from the book's own contents page (a page headed "Contents", "Table of
Contents", "Contents at a Glance", "Brief Contents" or "Chapters"); without
one, dry-run and load stop with "Chapters weren't found". Title and slug
are derived from the directory — see [../docs/migration.md](../docs/migration.md).

```sh
npm install                                                   # installs both packages
npm test                                                      # parser tests
# set UPLOAD_BOOK_PATH in .env to the book's Markdown directory first
npm run dry-run                                               # -> book-output.md (readable report), no DB needed
npm run load -- --category programming-languages
                                                              # requires DATABASE_URL (see .env.example) and the schema
                                                              # (cd ../backend && npm run migrate)
```

The book is always `UPLOAD_BOOK_PATH` from `.env`; to switch books, change it there.
`dry-run` flags: `--out <file>`, `--title`, `--slug`, `--no-analyze` (skip
syntax analysis), `--all-diagnostics` (print info-level diagnostics too).
`npm run import -- <folder> [--apply]` surveys every book under a folder and,
with `--apply`, loads the new ones and reloads the rest.

`load` adds a new book (it refuses a slug that's already loaded); `reload`
updates a loaded one in place, keeping readers' annotations, reading
positions, shelves and editors' revisions and drafts; `load -- --reset`
deletes the book and loads it fresh. `load`/`reload` flags: `--title`, `--slug`, `--author`, `--category <slug>`,
`--allow-errors` (load even if the parse reported errors), `--out <file>`,
`--publish` (make the book and its sections visible to readers right away -
otherwise they're drafts). The backend picks up a reloaded book right away.

A `book.json` next to the book's `markdown/` folder holds its title, slug,
author, category, publish state, language and which Markdown folder to read,
so `load`/`reload` need no flags - see
[../docs/migration.md](../docs/migration.md#book-metadata-bookjson).

`organize` flags: `--apply` (otherwise only the plan is printed), `--show`,
`--contents <path>`, `--pdf-contents <first>-<last>` - see
[../docs/migration.md](../docs/migration.md#splitting-chapters-into-sections-npm-run-organize).
