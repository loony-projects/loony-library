# migration

Parses a book's markdown source into the Postgres schema defined in
[schema.sql](./schema.sql). Config-driven — each book is a small JSON file
under [books/](./books/) naming its source directory, metadata, and which
outline-building strategy to use. See [../docs/migration.md](../docs/migration.md)
for how it works and how to write a new book config.

```sh
npm install
npm run dry-run -- --book books/jougabodo-rawokhanthi.json   # -> outline.json, no DB needed
npm run load -- --book books/jougabodo-rawokhanthi.json      # requires DATABASE_URL (see .env.example) + schema.sql already applied
```
