import fs from "node:fs";
import path from "node:path";
import { buildOutlineByToc, slugify } from "./buildOutlineByToc.js";
import { parseFile } from "./parseFile.js";
import { collectTerms } from "./extractTermList.js";
import { finalizeOutline } from "./finalize.js";
import { createDiagnostics } from "./diagnostics.js";
import "./analysis/index.js"; // registers the built-in analyzers before any parse

// Pipeline (see docs/migration.md):
//   1 ingestion (markdown.js) -> 2+4 traversal/blocks (parseFile.js)
//   -> 3 structure from the contents page (toc.js, buildOutlineByToc.js)
//   -> 5 references (extractTermList.js)
//   -> 6 code index (finalize.js, languages.js) -> 7 diagnostics
//   -> 8 result { book, chapters, glossary, symbols, codeBlocks, diagnostics }
//   and, optionally and asynchronously, 6c analyzeCodeBlocks (analysis/).

export { parseFile, extractItems, astOf } from "./parseFile.js";
export { buildOutlineByToc, slugify };
export { readTableOfContents } from "./toc.js";
export { extractTermList, extractTermEntries, collectTerms, termKey } from "./extractTermList.js";
export { registerLanguage, normalizeLanguage, parseFenceInfo, getLanguage, listLanguages } from "./languages.js";
export { analyzeCodeBlocks, registerAnalyzer, unregisterAnalyzer, getAnalyzer, hasAnalyzer } from "./analysis/index.js";
export { formatDiagnostic, countBySeverity, printDiagnostics } from "./diagnostics.js";
export { countBlocks, summarize } from "./stats.js";
export { renderBookMarkdown } from "./bookOutput.js";
export { ROLES, normalizeRole } from "./roles.js";
export { parseHeadingText } from "./headings.js";

// A book is a directory of Markdown - typically pdf-to-md output
// (<name>_page_NNNN.md files, <name>_metadata.json, images/). Everything
// about the book comes from that directory; there is no per-book config.
//
// Every *.md directly in it is a page, in numeric-aware name order
// ("page_2" before "page_10"). Chapters come only from the book's own
// contents page (toc.js); without one the result has no chapters and a
// toc.not_found error.

function readMetadataName(sourceDir, files, diagnostics) {
  const metaFile = files.find((f) => f.endsWith("_metadata.json"));
  if (!metaFile) return null;
  try {
    const name = JSON.parse(fs.readFileSync(path.join(sourceDir, metaFile), "utf8"))?.pdf?.name;
    return typeof name === "string" && name.trim() ? name.replace(/\.pdf$/i, "") : null;
  } catch (err) {
    diagnostics.warning("source.bad_metadata", `${metaFile} is not valid JSON (${err.message}); title taken from the folder name.`, {
      file: metaFile,
    });
    return null;
  }
}

// Title: the PDF name from <name>_metadata.json, else the folder name (its
// parent's when the folder is just "markdown"), underscores as spaces.
function bookMetadata(sourceDir, files, overrides, diagnostics) {
  const folder = path.basename(sourceDir).toLowerCase() === "markdown" ? path.basename(path.dirname(sourceDir)) : path.basename(sourceDir);
  const title = overrides.title ?? (readMetadataName(sourceDir, files, diagnostics) ?? folder).replace(/_+/g, " ").trim();
  return { slug: overrides.slug ?? slugify(title), title, author: overrides.author ?? null, sourceDir };
}

// An error in how a command was invoked or configured (bad option, missing
// or wrong UPLOAD_BOOK_PATH) - CLIs print just the message, no stack.
export class UsageError extends Error {}

// The book to parse is always UPLOAD_BOOK_PATH from book-import/.env.
export function bookDirFromEnv() {
  const dir = process.env.UPLOAD_BOOK_PATH?.trim();
  if (!dir) throw new UsageError("UPLOAD_BOOK_PATH is not set. Put the book's Markdown directory in book-import/.env, e.g. UPLOAD_BOOK_PATH=/home/me/.output/NodeJs/Beginning_Nodejs/markdown");
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new UsageError(`UPLOAD_BOOK_PATH in book-import/.env is not a directory: ${dir}`);
  }
  return dir;
}

/**
 * Parses a book's Markdown directory into the outline the migration package
 * loads into Postgres. Synchronous; code blocks come back with
 * analysisStatus "unanalysed" - run analyzeCodeBlocks() for syntax analysis.
 *   overrides: { title?, slug?, author? } - otherwise derived from the directory.
 */
export function parseBookDirectory(dir, overrides = {}) {
  if (!dir) throw new Error("A Markdown directory is required");
  const sourceDir = path.resolve(dir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Not a directory: ${sourceDir}`);
  }
  const diagnostics = createDiagnostics();
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const book = bookMetadata(sourceDir, entries.map((e) => e.name), overrides, diagnostics);

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!files.length) {
    diagnostics.error("source.empty", "The book directory has no Markdown (.md) files.", {});
    return assemble(book, [], diagnostics);
  }
  const sources = files.map((file) => ({ file, source: fs.readFileSync(path.join(sourceDir, file), "utf8") }));
  const chapters = buildOutlineByToc(parseSources(sources, diagnostics), { diagnostics });
  return assemble(book, chapters, diagnostics);
}

function parseSources(sources, diagnostics) {
  return sources.map(({ file, source }) => ({ file, items: parseFile(source, { file, diagnostics }) }));
}

// Glossary and symbol entries come from elements whose role is glossary /
// symbols - a contents entry titled "Glossary", "Abbreviations" or
// "Symbols" (see finalize.js / extractTermList.js).
function buildReferences(termSources, diagnostics) {
  const glossary = collectTerms(termSources.glossary, { kind: "glossary", diagnostics });
  // Symbols are compared case-sensitively ("N" and "n" are different symbols).
  const symbols = collectTerms(termSources.symbols, { kind: "symbols", caseSensitive: true, diagnostics }).map(
    ({ term, expansion, ...rest }) => ({ symbol: term, description: expansion, ...rest })
  );
  return { glossary, symbols };
}

function assemble(book, chapters, diagnostics) {
  const { codeBlocks, termSources } = finalizeOutline(chapters, { diagnostics });
  const { glossary, symbols } = buildReferences(termSources, diagnostics);
  return { book, chapters, glossary, symbols, codeBlocks, diagnostics: diagnostics.list };
}

/**
 * Parses a book given as Markdown pages in memory (no filesystem), with the
 * same rules as parseBookDirectory: chapters come only from a contents page.
 *   pages:    [{ file, source }] in reading order
 *   metadata: book metadata to return as result.book
 */
export function parseBookPages(pages, metadata = {}) {
  const diagnostics = createDiagnostics();
  const chapters = pages.length
    ? buildOutlineByToc(parseSources(pages, diagnostics), { diagnostics })
    : (diagnostics.error("source.empty", "No Markdown pages given.", {}), []);
  return assemble({ ...metadata }, chapters, diagnostics);
}
