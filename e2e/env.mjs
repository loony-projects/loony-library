// Shared settings: the database (DATABASE_URL, or backend/.env's), the
// throwaway schema everything runs in, and the backend's port.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, "backend", ".env") }); // DATABASE_URL, unless already set

export const SCHEMA = "e2e";
export const PORT = 4199;
export const BASE_URL = `http://localhost:${PORT}`;
export const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set (and backend/.env has none)");

// Every process the test starts sees only the throwaway schema.
export const childEnv = {
  ...process.env,
  DATABASE_URL,
  PGOPTIONS: `-c search_path=${SCHEMA}`,
};
