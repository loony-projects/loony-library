import { pool } from "../src/db.js";
import fs from "node:fs/promises";
const db = await pool.connect();
try {
  await db.query("select pg_advisory_lock(839412)");
  await db.query(
    "create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const name = "001-library.sql";
  const { rows } = await db.query(
    "select name from app_migrations where name=$1",
    [name],
  );
  if (!rows.length) {
    const sql = await fs.readFile(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    await db.query(
      sql
        .replace(/^begin;/m, "")
        .replace(/^commit;/m, "")
        .replace(/^/, "begin;\n") +
        `\ninsert into app_migrations(name) values ('${name}');\ncommit;`,
    );
    console.log(`Applied ${name}`);
  } else console.log("Database is up to date");
} finally {
  await db.query("select pg_advisory_unlock(839412)");
  db.release();
  await pool.end();
}
