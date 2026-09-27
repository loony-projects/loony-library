import { pool } from "../src/db.js";
const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run editor -- email@example.com");
  process.exitCode = 1;
} else {
  const { rowCount } = await pool.query(
    "update users set role='editor' where email=$1",
    [email.trim().toLowerCase()],
  );
  console.log(
    rowCount
      ? "Editor access granted"
      : "No account with that email. Register first.",
  );
  if (!rowCount) process.exitCode = 1;
}
await pool.end();
