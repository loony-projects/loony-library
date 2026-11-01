import pg from "pg";
import { SCHEMA, DATABASE_URL } from "./env.mjs";

export default async function teardown() {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await admin.end();
}
