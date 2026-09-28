import { pool } from "../src/db.js";
import fs from "node:fs/promises";
// Applies every migrations/*.sql not yet recorded in app_migrations, in
// filename order, each in its own transaction.
const dir = new URL("../migrations/", import.meta.url);
const db = await pool.connect();
try {
  await db.query("select pg_advisory_lock(839412)");
  await db.query(
    "create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await db.query("select name from app_migrations");
  const applied = new Set(rows.map((r) => r.name));
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
} finally {
  await db.query("select pg_advisory_unlock(839412)");
  db.release();
  await pool.end();
}
