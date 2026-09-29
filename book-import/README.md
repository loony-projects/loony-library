# book-import

Turns a book's markdown source into the Postgres schema defined in
[packages/migration/schema.sql](./packages/migration/schema.sql). An npm
workspace of two packages:

- [packages/markdown-parser](./packages/markdown-parser/) — markdown → outline
  (`{ book, chapters, glossary, symbols, codeBlocks, diagnostics }`), no
  database needed. Also used by the backend's section editor.
- [packages/migration](./packages/migration/) — parses via the package above,
  copies images, and loads the outline into Postgres.

Config-driven — each book is a small JSON file
under [books/](./books/) naming its source directory, metadata, and which
outline-building strategy to use. See [../docs/migration.md](../docs/migration.md)
for how it works and how to write a new book config.

```sh
npm install                                                  # installs both packages
npm test                                                     # parser tests
npm run dry-run -- --book books/jougabodo-rawokhanthi.json   # -> outline.json (+ code analysis), no DB needed
npm run load -- --book books/jougabodo-rawokhanthi.json      # requires DATABASE_URL (see .env.example), packages/migration/schema.sql
                                                             # and the backend's migrations (cd ../backend && npm run migrate)
```

`dry-run` flags: `--no-analyze` (skip syntax analysis), `--all-diagnostics`
(print info-level diagnostics too). `load` refuses to load a book whose parse
reported errors unless given `--allow-errors`.
