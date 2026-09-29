# book-import

Turns a book's markdown source into the Postgres schema defined in
[packages/migration/schema.sql](./packages/migration/schema.sql). An npm
workspace of two packages:

- [packages/markdown-parser](./packages/markdown-parser/) — markdown → outline
  (`{ book, chapters, glossary, symbols, codeBlocks, diagnostics }`), no
  database needed. Also used by the backend's section editor.
- [packages/migration](./packages/migration/) — parses via the package above,
  copies images, and loads the outline into Postgres.

The input is a book's Markdown directory (e.g. pdf-to-md output:
`<name>_page_NNNN.md`, `<name>_metadata.json`, `images/`). Chapters come
from the book's own contents page when it has one; title, slug and
structure are derived from the directory — see [../docs/migration.md](../docs/migration.md).

```sh
npm install                                                   # installs both packages
npm test                                                      # parser tests
npm run dry-run -- ~/.output/NodeJs/Beginning_Nodejs/markdown # -> outline.json (+ code analysis), no DB needed
npm run load -- ~/.output/NodeJs/Beginning_Nodejs/markdown --category programming-languages
                                                              # requires DATABASE_URL (see .env.example), packages/migration/schema.sql
                                                              # and the backend's migrations (cd ../backend && npm run migrate)
```

Without a directory argument, `UPLOAD_BOOK_PATH` from `.env` is used.
`dry-run` flags: `--out <file>`, `--title`, `--slug`, `--no-analyze` (skip
syntax analysis), `--all-diagnostics` (print info-level diagnostics too).
`load`/`reload` flags: `--title`, `--slug`, `--author`, `--category <slug>`,
`--allow-errors` (load even if the parse reported errors), `--out <file>`.
