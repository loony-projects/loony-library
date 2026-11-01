// Before the browser test: a fresh `e2e` schema with the app's migrations,
// the fixture book loaded by book-import, and the frontend built for the
// backend to serve (same origin).
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { ROOT, SCHEMA, DATABASE_URL, childEnv } from "./env.mjs";

const run = (cmd, args, cwd, env = childEnv) => execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"] });

const admin = new pg.Client({ connectionString: DATABASE_URL });
await admin.connect();
await admin.query(`drop schema if exists ${SCHEMA} cascade`);
await admin.query(`create schema ${SCHEMA}`);
await admin.end();

run("npm", ["run", "--silent", "migrate"], path.join(ROOT, "backend"));
run("npm", ["run", "--silent", "load"], path.join(ROOT, "book-import"), {
  ...childEnv,
  UPLOAD_BOOK_PATH: path.join(ROOT, "e2e", "fixtures", "e2e-book"),
});
// Quiet unless it fails: Vite lists every asset.
try {
  execFileSync("npm", ["run", "--silent", "build"], { cwd: path.join(ROOT, "frontend"), env: { ...childEnv, VITE_API_URL: "" }, stdio: "pipe" });
} catch (error) {
  process.stderr.write(error.stdout ?? "");
  process.stderr.write(error.stderr ?? "");
  throw error;
}
