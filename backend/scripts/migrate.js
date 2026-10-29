import { pool } from "../src/db.js";
import fs from "node:fs/promises";
// Applies every migrations/*.sql not yet recorded in app_migrations, in
// filename order, each in its own transaction. On an empty database this
// creates the whole schema (001-schema.sql).
const dir = new URL("../migrations/", import.meta.url);

// 001-schema.sql replaced book-import's schema.sql plus these four
// migrations, and creates exactly the schema they produced. A database
// that applied all four already has it, so 001-schema.sql is recorded as
// applied there instead of being run.
const LEGACY_CHAIN = [
  "001-library.sql",
  "002-categories.sql",
  "003-loony-auth.sql",
  "004-parser-blocks-and-roles.sql",
];
const BASELINE = "001-schema.sql";

// A problem with the database's state, reported as one readable line.
class MigrationError extends Error {}

const db = await pool.connect();
try {
  await db.query("select pg_advisory_lock(839412)");
  await db.query(
    "create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await db.query("select name from app_migrations");
  const applied = new Set(rows.map((r) => r.name));

  if (!applied.has(BASELINE)) {
    const legacy = LEGACY_CHAIN.filter((name) => applied.has(name));
    const {
      rows: [{ exists: hasBooks }],
    } = await db.query("select to_regclass('books') is not null as exists");
    if (legacy.length === LEGACY_CHAIN.length) {
      await db.query("insert into app_migrations(name) values ($1)", [BASELINE]);
      applied.add(BASELINE);
      console.log(`Recorded ${BASELINE} as applied (this database has the equivalent older migrations)`);
    } else if (legacy.length || hasBooks) {
      throw new MigrationError(
        `This database has an older, partly migrated schema (applied: ${legacy.join(", ") || "none"}). ` +
          `Apply the remaining old migrations with the previous version of the backend first, or recreate the database.`,
      );
    }
  }

  const pending = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql") && !applied.has(f))
    .sort();
  for (const name of pending) {
    const sql = await fs.readFile(new URL(name, dir), "utf8");
    try {
      await db.query("begin");
      await db.query(sql.replace(/^begin;/m, "").replace(/^commit;/m, ""));
      await db.query("insert into app_migrations(name) values ($1)", [name]);
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
    console.log(`Applied ${name}`);
  }
  if (!pending.length) console.log("Database is up to date");
} catch (e) {
  if (!(e instanceof MigrationError)) throw e;
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.query("select pg_advisory_unlock(839412)");
  db.release();
  await pool.end();
}
