import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./errors.js";

// book.json: a book's own metadata, kept in its folder next to markdown/, so
// loading and reloading it needs no --title/--author/... flags:
//
//   {
//     "title": "Natural Language Processing with Transformers",
//     "slug": "nlp-with-transformer-models",
//     "author": "Lewis Tunstall, Leandro von Werra, Thomas Wolf",
//     "category": "computer-science",
//     "publish": true,
//     "source": "markdown-cleaned"
//   }
//
// "source" is the Markdown folder to read, relative to book.json (default:
// markdown/). Command-line flags win over the file.

export const MANIFEST_FIELDS = {
  title: "string",
  slug: "string",
  author: "string",
  publisher: "string",
  isbn: "string",
  edition: "string",
  year: "integer",
  language: "string",
  series: "string",
  volume: "number",
  category: "string",
  publish: "boolean",
  source: "string",
};

const MARKDOWN_DIR = /^markdown(?:[-_].*)?$/i;

export class ManifestError extends UsageError {}

// The book.json for a book given as its folder or its markdown/ folder.
export function findManifest(dir) {
  const resolved = path.resolve(dir);
  const candidates = [path.join(resolved, "book.json")];
  if (MARKDOWN_DIR.test(path.basename(resolved))) candidates.push(path.join(path.dirname(resolved), "book.json"));
  const file = candidates.find((f) => fs.existsSync(f));
  return file ? { file, bookDir: path.dirname(file), data: readManifest(file) } : null;
}

export function readManifest(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ManifestError(`${file} isn't valid JSON: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ManifestError(`${file} must hold a JSON object`);
  for (const [field, value] of Object.entries(data)) {
    const type = MANIFEST_FIELDS[field];
    if (!type) throw new ManifestError(`${file}: unknown field "${field}" (known: ${Object.keys(MANIFEST_FIELDS).join(", ")})`);
    const ok = type === "integer" ? Number.isInteger(value) : typeof value === type && (type !== "string" || value.trim() !== "");
    if (!ok) throw new ManifestError(`${file}: "${field}" must be ${type === "integer" ? "a whole number" : `a${type === "string" ? " non-empty" : ""} ${type}`}`);
  }
  return data;
}
